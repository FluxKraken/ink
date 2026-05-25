import { parseInkBuilderOptions, parseStaticExpression } from "./parser.js";

export type ImportBinding =
  | {
    source: string;
    kind: "named";
    imported: string;
  }
  | {
    source: string;
    kind: "namespace";
  }
  | {
    source: string;
    kind: "default";
  };

export type ModuleStaticInfo = {
  imports: Map<string, ImportBinding>;
  constInitializers: Map<
    string,
    { initializer: string; start: number; end: number; exported: boolean }
  >;
  functionDeclarations: Map<string, string>;
  exportedConsts: Map<string, string>;
  defaultExportExpression: string | null;
};

export type TypeScriptAstApi = {
  createSourceFile: (
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes?: boolean,
    scriptKind?: number,
  ) => unknown;
  ScriptTarget: { ES2020: number };
  ScriptKind: Record<string, number>;
  SyntaxKind: Record<string, number>;
  forEachChild: (node: unknown, cbNode: (node: unknown) => void) => void;
};

export type AstInkCall = {
  start: number;
  end: number;
  callee: string;
  arg: string;
};

export type AstNewInkAssignment = {
  property: string;
  start: number;
  end: number;
  valueSource: string;
};

export type AstNewInkDeclaration = {
  varName: string;
  start: number;
  initializerStart: number;
  initializerEnd: number;
  constructorSource: string;
  optionsSource?: string;
  hasStaticOptions: boolean;
  simple: boolean;
  hasAddContainerCall: boolean;
  assignments: AstNewInkAssignment[];
};

export type AstTransformTargets = {
  calls: AstInkCall[];
  newInkDecls: AstNewInkDeclaration[];
};

export type CollectTransformTargetsOptions = {
  typescript: TypeScriptAstApi | null;
  code: string;
  id: string;
  offset?: number;
  inkImportSources: readonly string[];
};

const BUILDER_ASSIGNMENT_PROPERTIES = new Set([
  "base",
  "global",
  "themes",
  "fonts",
  "root",
  "rootVars",
  "variant",
  "defaults",
  "tailwind",
  "tailwindCss",
  "modules",
]);

type AstScopeEntry =
  | { kind: "ink-import" }
  | { kind: "ink-namespace" }
  | { kind: "builder"; declaration: AstNewInkDeclaration }
  | null;

function scriptKindForModule(
  typescript: TypeScriptAstApi,
  moduleId: string,
): number {
  const cleanId = moduleId.replace(/[?#].*$/, "");
  if (cleanId.endsWith(".tsx")) {
    return typescript.ScriptKind.TSX;
  }
  if (cleanId.endsWith(".jsx")) {
    return typescript.ScriptKind.JSX;
  }
  if (
    cleanId.endsWith(".ts") ||
    cleanId.endsWith(".mts") ||
    cleanId.endsWith(".cts") ||
    cleanId.endsWith(".svelte") ||
    cleanId.endsWith(".astro")
  ) {
    return typescript.ScriptKind.TS;
  }
  return typescript.ScriptKind.JS;
}

function createSourceFile(
  typescript: TypeScriptAstApi,
  code: string,
  id: string,
): Record<string, unknown> {
  return typescript.createSourceFile(
    id,
    code,
    typescript.ScriptTarget.ES2020,
    true,
    scriptKindForModule(typescript, id),
  ) as Record<string, unknown>;
}

function astNodeStart(node: unknown, sourceFile: unknown): number {
  if (
    node &&
    typeof node === "object" &&
    "getStart" in (node as Record<string, unknown>) &&
    typeof (node as { getStart?: unknown }).getStart === "function"
  ) {
    return (node as { getStart: (sourceFile?: unknown) => number }).getStart(
      sourceFile,
    );
  }

  return (node as { pos?: number } | null)?.pos ?? 0;
}

function astNodeEnd(node: unknown): number {
  return (node as { end?: number } | null)?.end ?? 0;
}

function astNodeText(
  node: unknown,
  code: string,
  sourceFile: unknown,
): string {
  return code.slice(astNodeStart(node, sourceFile), astNodeEnd(node));
}

function astIdentifierText(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  const textValue = (node as { text?: unknown }).text;
  if (typeof textValue === "string") {
    return textValue;
  }

  const escapedText = (node as { escapedText?: unknown }).escapedText;
  if (typeof escapedText === "string") {
    return escapedText;
  }

  return null;
}

function astStringLiteralText(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }
  const text = (node as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function hasModifier(
  node: unknown,
  modifierKind: number,
): boolean {
  const modifiers = (node as { modifiers?: unknown[] } | null)?.modifiers;
  return Array.isArray(modifiers) &&
    modifiers.some((modifier) =>
      (modifier as { kind?: unknown } | null)?.kind === modifierKind
    );
}

function isTypeOnlyNode(node: unknown): boolean {
  return (node as { isTypeOnly?: unknown } | null)?.isTypeOnly === true;
}

function declarationIsConst(
  declarationList: unknown,
  code: string,
  sourceFile: unknown,
): boolean {
  return astNodeText(declarationList, code, sourceFile).trimStart()
    .startsWith("const ");
}

export function parseModuleStaticInfo(
  code: string,
  id: string,
  typescript: TypeScriptAstApi | null,
): ModuleStaticInfo {
  const imports = new Map<string, ImportBinding>();
  const constInitializers = new Map<
    string,
    { initializer: string; start: number; end: number; exported: boolean }
  >();
  const functionDeclarations = new Map<string, string>();
  const exportedConsts = new Map<string, string>();
  let defaultExportExpression: string | null = null;

  if (!typescript) {
    return {
      imports,
      constInitializers,
      functionDeclarations,
      exportedConsts,
      defaultExportExpression,
    };
  }

  const ast = typescript;
  const sourceFile = createSourceFile(ast, code, id);
  const syntaxKind = ast.SyntaxKind;

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") {
      return;
    }

    const kind = (node as { kind?: number }).kind;

    if (kind === syntaxKind.ImportDeclaration) {
      const importNode = node as {
        importClause?: {
          isTypeOnly?: boolean;
          name?: unknown;
          namedBindings?: unknown;
        };
        moduleSpecifier?: unknown;
      };
      const source = astStringLiteralText(importNode.moduleSpecifier);
      const clause = importNode.importClause;
      if (!source || !clause || clause.isTypeOnly === true) {
        return;
      }

      const defaultName = astIdentifierText(clause.name);
      if (defaultName) {
        imports.set(defaultName, { source, kind: "default" });
      }

      const namedBindings = clause.namedBindings as {
        kind?: number;
        name?: unknown;
        elements?: unknown[];
      } | undefined;
      if (!namedBindings) {
        return;
      }

      if (namedBindings.kind === syntaxKind.NamespaceImport) {
        const namespaceName = astIdentifierText(namedBindings.name);
        if (namespaceName) {
          imports.set(namespaceName, { source, kind: "namespace" });
        }
        return;
      }

      if (namedBindings.kind === syntaxKind.NamedImports) {
        for (const element of namedBindings.elements ?? []) {
          if (isTypeOnlyNode(element)) {
            continue;
          }
          const imported = astIdentifierText(
            (element as { propertyName?: unknown }).propertyName,
          ) ?? astIdentifierText((element as { name?: unknown }).name);
          const local = astIdentifierText((element as { name?: unknown }).name);
          if (imported && local) {
            imports.set(local, { source, kind: "named", imported });
          }
        }
      }
      return;
    }

    if (kind === syntaxKind.ExportDeclaration) {
      const exportNode = node as {
        isTypeOnly?: boolean;
        exportClause?: { kind?: number; elements?: unknown[] };
      };
      if (
        exportNode.isTypeOnly === true ||
        exportNode.exportClause?.kind !== syntaxKind.NamedExports
      ) {
        return;
      }

      for (const element of exportNode.exportClause.elements ?? []) {
        if (isTypeOnlyNode(element)) {
          continue;
        }
        const exported = astIdentifierText(
          (element as { name?: unknown }).name,
        );
        const local = astIdentifierText(
          (element as { propertyName?: unknown }).propertyName,
        ) ?? exported;
        if (exported && local) {
          exportedConsts.set(exported, local);
        }
      }
      return;
    }

    if (kind === syntaxKind.ExportAssignment) {
      const exportNode = node as {
        isExportEquals?: boolean;
        expression?: unknown;
      };
      if (exportNode.isExportEquals === true || !exportNode.expression) {
        return;
      }
      defaultExportExpression = astNodeText(
        exportNode.expression,
        code,
        sourceFile,
      ).trim();
      return;
    }

    if (kind === syntaxKind.VariableStatement) {
      const variableStatement = node as {
        declarationList?: { declarations?: unknown[] };
      };
      const declarationList = variableStatement.declarationList;
      if (
        !declarationList ||
        !declarationIsConst(declarationList, code, sourceFile)
      ) {
        return;
      }

      const exported = hasModifier(node, syntaxKind.ExportKeyword);
      for (const declaration of declarationList.declarations ?? []) {
        const name = astIdentifierText(
          (declaration as { name?: unknown }).name,
        );
        const initializer = (declaration as { initializer?: unknown })
          .initializer;
        if (!name || !initializer) {
          continue;
        }
        const initializerSource = astNodeText(initializer, code, sourceFile)
          .trim();
        if (initializerSource.length > 0) {
          constInitializers.set(name, {
            initializer: initializerSource,
            start: astNodeStart(node, sourceFile),
            end: astNodeEnd(node),
            exported,
          });
        }
        if (exported) {
          exportedConsts.set(name, name);
        }
      }
      return;
    }

    if (kind === syntaxKind.FunctionDeclaration) {
      const name = astIdentifierText((node as { name?: unknown }).name);
      const exported = hasModifier(node, syntaxKind.ExportKeyword);
      const defaultExported = hasModifier(node, syntaxKind.DefaultKeyword);
      const declarationSource = astNodeText(node, code, sourceFile)
        .replace(/^export\s+default\s+/, "")
        .replace(/^export\s+/, "")
        .trim();
      if (
        exported && defaultExported && defaultExportExpression === null &&
        declarationSource.length > 0
      ) {
        defaultExportExpression = declarationSource;
      }
      if (name) {
        functionDeclarations.set(name, declarationSource);
        if (exported) {
          exportedConsts.set(name, name);
        }
      }
      return;
    }

    ast.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    imports,
    constInitializers,
    functionDeclarations,
    exportedConsts,
    defaultExportExpression,
  };
}

function resolveScopeEntry(
  scopes: readonly Map<string, AstScopeEntry>[],
  name: string,
): AstScopeEntry | undefined {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    if (scope.has(name)) {
      return scope.get(name);
    }
  }
  return undefined;
}

function isInkConstructorExpression(
  node: unknown,
  scopes: readonly Map<string, AstScopeEntry>[],
  typescript: TypeScriptAstApi,
): boolean {
  const syntaxKind = typescript.SyntaxKind;
  const identifier = astIdentifierText(node);
  if (identifier) {
    return resolveScopeEntry(scopes, identifier)?.kind === "ink-import";
  }

  if (
    !node || typeof node !== "object" ||
    (node as { kind?: number }).kind !== syntaxKind.PropertyAccessExpression
  ) {
    return false;
  }

  const access = node as { expression?: unknown; name?: unknown };
  const namespaceName = astIdentifierText(access.expression);
  const propertyName = astIdentifierText(access.name);
  return propertyName === "default" &&
    namespaceName !== null &&
    resolveScopeEntry(scopes, namespaceName)?.kind === "ink-namespace";
}

function isInkObjectCall(
  node: unknown,
  scopes: readonly Map<string, AstScopeEntry>[],
  typescript: TypeScriptAstApi,
): node is { expression: unknown; arguments: unknown[]; end: number } {
  const syntaxKind = typescript.SyntaxKind;
  if (
    !node || typeof node !== "object" ||
    (node as { kind?: number }).kind !== syntaxKind.CallExpression
  ) {
    return false;
  }

  const call = node as { expression?: unknown; arguments?: unknown[] };
  return Boolean(
    isInkConstructorExpression(call.expression, scopes, typescript) &&
      Array.isArray(call.arguments) &&
      call.arguments.length > 0 &&
      (call.arguments[0] as { kind?: number } | undefined)?.kind ===
        syntaxKind.ObjectLiteralExpression,
  );
}

function isNewInkBuilder(
  node: unknown,
  scopes: readonly Map<string, AstScopeEntry>[],
  typescript: TypeScriptAstApi,
): node is { expression: unknown; arguments?: unknown[]; end: number } {
  const syntaxKind = typescript.SyntaxKind;
  if (
    !node || typeof node !== "object" ||
    (node as { kind?: number }).kind !== syntaxKind.NewExpression
  ) {
    return false;
  }

  const expression = (node as { expression?: unknown }).expression;
  const args = (node as { arguments?: unknown[] }).arguments;
  return isInkConstructorExpression(expression, scopes, typescript) &&
    (args?.length ?? 0) <= 1;
}

function setScopeBinding(
  nameNode: unknown,
  scope: Map<string, AstScopeEntry>,
  value: AstScopeEntry = null,
): void {
  const name = astIdentifierText(nameNode);
  if (name) {
    scope.set(name, value);
  }
}

function addBindingPattern(
  nameNode: unknown,
  scope: Map<string, AstScopeEntry>,
  typescript: TypeScriptAstApi,
): void {
  if (!nameNode || typeof nameNode !== "object") {
    return;
  }

  const syntaxKind = typescript.SyntaxKind;
  const node = nameNode as Record<string, unknown>;
  if (node.kind === syntaxKind.Identifier) {
    setScopeBinding(node, scope);
    return;
  }

  if (node.kind === syntaxKind.ObjectBindingPattern) {
    const elements = node.elements;
    if (Array.isArray(elements)) {
      for (const element of elements) {
        addBindingPattern(
          (element as { name?: unknown } | null)?.name,
          scope,
          typescript,
        );
      }
    }
    return;
  }

  if (node.kind === syntaxKind.ArrayBindingPattern) {
    const elements = node.elements;
    if (Array.isArray(elements)) {
      for (const element of elements) {
        addBindingPattern(
          (element as { name?: unknown } | null)?.name,
          scope,
          typescript,
        );
      }
    }
  }
}

function resolveBuilderDeclaration(
  scopes: readonly Map<string, AstScopeEntry>[],
  name: string,
): AstNewInkDeclaration | null {
  const entry = resolveScopeEntry(scopes, name);
  return entry?.kind === "builder" ? entry.declaration : null;
}

function sourceIsInkModule(
  source: string,
  inkImportSources: readonly string[],
): boolean {
  return inkImportSources.includes(source);
}

function registerImportBindings(
  moduleInfo: ModuleStaticInfo,
  scope: Map<string, AstScopeEntry>,
  inkImportSources: readonly string[],
): void {
  for (const [localName, binding] of moduleInfo.imports) {
    scope.set(localName, null);
  }

  for (const [localName, binding] of moduleInfo.imports) {
    const isInkSource = sourceIsInkModule(binding.source, inkImportSources);
    if (
      binding.kind === "default" &&
      (isInkSource || localName === "ink")
    ) {
      scope.set(localName, { kind: "ink-import" });
      continue;
    }

    if (
      binding.kind === "named" &&
      binding.imported === "default" &&
      (isInkSource || localName === "ink")
    ) {
      scope.set(localName, { kind: "ink-import" });
      continue;
    }

    if (binding.kind === "namespace" && isInkSource) {
      scope.set(localName, { kind: "ink-namespace" });
    }
  }
}

function predeclareStatementBindings(
  statements: unknown[] | undefined,
  scope: Map<string, AstScopeEntry>,
  typescript: TypeScriptAstApi,
): void {
  if (!Array.isArray(statements)) {
    return;
  }

  const syntaxKind = typescript.SyntaxKind;
  for (const statement of statements) {
    if (!statement || typeof statement !== "object") {
      continue;
    }
    const kind = (statement as { kind?: number }).kind;
    if (kind === syntaxKind.VariableStatement) {
      const declarations =
        (statement as { declarationList?: { declarations?: unknown[] } })
          .declarationList?.declarations;
      for (const declaration of declarations ?? []) {
        addBindingPattern(
          (declaration as { name?: unknown }).name,
          scope,
          typescript,
        );
      }
      continue;
    }
    if (
      kind === syntaxKind.FunctionDeclaration ||
      kind === syntaxKind.ClassDeclaration
    ) {
      setScopeBinding((statement as { name?: unknown }).name, scope);
    }
  }
}

export function collectTransformTargets(
  options: CollectTransformTargetsOptions,
): AstTransformTargets | null {
  const typescript = options.typescript;
  if (!typescript) {
    return null;
  }

  const ast = typescript;
  const offset = options.offset ?? 0;
  const sourceFile = createSourceFile(ast, options.code, options.id);
  const syntaxKind = ast.SyntaxKind;
  const calls: AstInkCall[] = [];
  const newInkDecls: AstNewInkDeclaration[] = [];
  const moduleInfo = parseModuleStaticInfo(options.code, options.id, ast);

  const withOffset = (value: number) => value + offset;

  function recordInkCall(
    node: unknown,
    scopes: readonly Map<string, AstScopeEntry>[],
  ): void {
    if (isInkObjectCall(node, scopes, ast)) {
      calls.push({
        start: withOffset(astNodeStart(node, sourceFile)),
        end: withOffset(astNodeEnd(node)),
        callee: astNodeText(node.expression, options.code, sourceFile),
        arg: astNodeText(node.arguments[0], options.code, sourceFile),
      });
    }
  }

  function registerVariableDeclaration(
    declaration: unknown,
    scope: Map<string, AstScopeEntry>,
    scopes: readonly Map<string, AstScopeEntry>[],
  ): void {
    if (!declaration || typeof declaration !== "object") {
      return;
    }

    const declarationNode = declaration as {
      name?: unknown;
      initializer?: unknown;
    };
    const name = astIdentifierText(declarationNode.name);
    if (!name) {
      addBindingPattern(declarationNode.name, scope, ast);
      return;
    }

    if (isNewInkBuilder(declarationNode.initializer, scopes, ast)) {
      const initializer = declarationNode.initializer;
      const initializerArgs = initializer.arguments ?? [];
      const optionsSource = initializerArgs.length > 0
        ? astNodeText(initializerArgs[0], options.code, sourceFile)
        : undefined;
      const parsedBuilderOptions = parseInkBuilderOptions(
        optionsSource ? parseStaticExpression(optionsSource) : undefined,
      ) ?? { simple: false };
      const builder: AstNewInkDeclaration = {
        varName: name,
        start: withOffset(astNodeStart(declaration, sourceFile)),
        initializerStart: withOffset(
          astNodeStart(initializer, sourceFile),
        ),
        initializerEnd: withOffset(astNodeEnd(initializer)),
        constructorSource: astNodeText(
          initializer.expression,
          options.code,
          sourceFile,
        ),
        optionsSource,
        hasStaticOptions: !optionsSource ||
          parseStaticExpression(optionsSource) !== null,
        simple: parsedBuilderOptions.simple,
        hasAddContainerCall: false,
        assignments: [],
      };
      newInkDecls.push(builder);
      scope.set(name, { kind: "builder", declaration: builder });
      return;
    }

    scope.set(name, null);
  }

  function recordBuilderMutation(
    statement: unknown,
    scopes: readonly Map<string, AstScopeEntry>[],
  ): void {
    if (!statement || typeof statement !== "object") {
      return;
    }

    const expression = (statement as { expression?: unknown }).expression;
    if (!expression || typeof expression !== "object") {
      return;
    }

    if (
      (expression as { kind?: number }).kind === syntaxKind.BinaryExpression
    ) {
      const binary = expression as {
        left?: unknown;
        right?: unknown;
        operatorToken?: { kind?: number };
      };
      if (binary.operatorToken?.kind !== syntaxKind.EqualsToken) {
        return;
      }

      const left = binary.left as {
        kind?: number;
        expression?: unknown;
        name?: unknown;
      } | null;
      if (!left || left.kind !== syntaxKind.PropertyAccessExpression) {
        return;
      }

      const varName = astIdentifierText(left.expression);
      const property = astIdentifierText(left.name);
      if (
        !varName || !property ||
        !BUILDER_ASSIGNMENT_PROPERTIES.has(property)
      ) {
        return;
      }

      const builder = resolveBuilderDeclaration(scopes, varName);
      if (!builder || !binary.right) {
        return;
      }

      builder.assignments.push({
        property,
        start: withOffset(astNodeStart(statement, sourceFile)),
        end: withOffset(astNodeEnd(statement)),
        valueSource: astNodeText(binary.right, options.code, sourceFile),
      });
      return;
    }

    if ((expression as { kind?: number }).kind !== syntaxKind.CallExpression) {
      return;
    }

    const call = expression as {
      expression?: unknown;
      arguments?: unknown[];
    };
    const access = call.expression as {
      kind?: number;
      expression?: unknown;
      name?: unknown;
    } | null;
    if (!access || access.kind !== syntaxKind.PropertyAccessExpression) {
      return;
    }

    const methodName = astIdentifierText(access.name);
    if (methodName !== "import" && methodName !== "importModule") {
      if (methodName !== "addContainer") {
        return;
      }

      const varName = astIdentifierText(access.expression);
      const builder = varName
        ? resolveBuilderDeclaration(scopes, varName)
        : null;
      if (builder) {
        builder.hasAddContainerCall = true;
      }
      return;
    }

    const varName = astIdentifierText(access.expression);
    const builder = varName ? resolveBuilderDeclaration(scopes, varName) : null;
    if (
      !builder || !Array.isArray(call.arguments) || call.arguments.length === 0
    ) {
      return;
    }

    const firstArg = call.arguments[0];
    const lastArg = call.arguments[call.arguments.length - 1];
    builder.assignments.push({
      property: methodName,
      start: withOffset(astNodeStart(statement, sourceFile)),
      end: withOffset(astNodeEnd(statement)),
      valueSource: options.code.slice(
        astNodeStart(firstArg, sourceFile),
        astNodeEnd(lastArg),
      ),
    });
  }

  function visitFunctionLike(
    node: unknown,
    parentScopes: readonly Map<string, AstScopeEntry>[],
  ): void {
    if (!node || typeof node !== "object") {
      return;
    }

    const functionNode = node as {
      name?: unknown;
      parameters?: unknown[];
      body?: unknown;
    };
    const scope = new Map<string, AstScopeEntry>();
    setScopeBinding(functionNode.name, scope);
    if (Array.isArray(functionNode.parameters)) {
      for (const parameter of functionNode.parameters) {
        addBindingPattern(
          (parameter as { name?: unknown } | null)?.name,
          scope,
          ast,
        );
      }
    }
    visitScopedNode(functionNode.body, [...parentScopes, scope]);
  }

  function visitStatementList(
    statements: unknown[] | undefined,
    parentScopes: readonly Map<string, AstScopeEntry>[],
    isRoot = false,
  ): void {
    if (!Array.isArray(statements)) {
      return;
    }

    const scope = new Map<string, AstScopeEntry>();
    if (isRoot) {
      registerImportBindings(moduleInfo, scope, options.inkImportSources);
    }
    predeclareStatementBindings(statements, scope, ast);
    const scopes = [...parentScopes, scope];

    for (const statement of statements) {
      visitScopedNode(statement, scopes);
    }
  }

  function visitScopedNode(
    node: unknown,
    scopes: readonly Map<string, AstScopeEntry>[],
  ): void {
    if (!node || typeof node !== "object") {
      return;
    }

    recordInkCall(node, scopes);

    const kind = (node as { kind?: number }).kind;
    if (kind === syntaxKind.SourceFile) {
      visitStatementList(
        (node as { statements?: unknown[] }).statements,
        [],
        true,
      );
      return;
    }

    if (kind === syntaxKind.ImportDeclaration) {
      return;
    }

    if (
      kind === syntaxKind.FunctionDeclaration ||
      kind === syntaxKind.FunctionExpression ||
      kind === syntaxKind.ArrowFunction ||
      kind === syntaxKind.MethodDeclaration ||
      kind === syntaxKind.GetAccessor ||
      kind === syntaxKind.SetAccessor ||
      kind === syntaxKind.Constructor
    ) {
      visitFunctionLike(node, scopes);
      return;
    }

    if (
      kind === syntaxKind.Block ||
      kind === syntaxKind.ModuleBlock ||
      kind === syntaxKind.CaseClause ||
      kind === syntaxKind.DefaultClause
    ) {
      visitStatementList(
        (node as { statements?: unknown[] }).statements,
        scopes,
      );
      return;
    }

    if (kind === syntaxKind.CatchClause) {
      const scope = new Map<string, AstScopeEntry>();
      addBindingPattern(
        (node as { variableDeclaration?: { name?: unknown } })
          .variableDeclaration
          ?.name,
        scope,
        ast,
      );
      visitScopedNode((node as { block?: unknown }).block, [...scopes, scope]);
      return;
    }

    if (kind === syntaxKind.VariableStatement && scopes.length > 0) {
      const declarations =
        (node as { declarationList?: { declarations?: unknown[] } })
          .declarationList?.declarations;
      if (Array.isArray(declarations)) {
        for (const declaration of declarations) {
          registerVariableDeclaration(
            declaration,
            scopes[scopes.length - 1],
            scopes,
          );
        }
      }
    }

    if (kind === syntaxKind.ExpressionStatement) {
      recordBuilderMutation(node, scopes);
    }

    ast.forEachChild(node, (child) => visitScopedNode(child, scopes));
  }

  visitScopedNode(sourceFile, []);

  const builderRanges = newInkDecls.flatMap((decl) => [
    { start: decl.initializerStart, end: decl.initializerEnd },
    ...decl.assignments.map((assignment) => ({
      start: assignment.start,
      end: assignment.end,
    })),
  ]);

  return {
    calls: calls.filter((call) =>
      !builderRanges.some((range) =>
        call.start >= range.start && call.end <= range.end
      )
    ),
    newInkDecls,
  };
}
