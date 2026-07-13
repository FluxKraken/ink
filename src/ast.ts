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
  reExports: Map<string, ImportBinding>;
  exportAllSources: string[];
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

export type AstInkConfigPropertyExpression = {
  expressionSource: string;
  identifierPath: string[] | null;
};

export type ExtractInkConfigPropertyExpressionOptions = {
  typescript: TypeScriptAstApi | null;
  code: string;
  id: string;
  property: string;
};

export type AstSourceReplacement = {
  start: number;
  end: number;
  replacement: string;
};

export type CollectUnusedRuntimeImportReplacementsOptions = {
  typescript: TypeScriptAstApi | null;
  code: string;
  id: string;
  /** Local import binding names that this transform is allowed to remove. */
  removableIdentifiers: ReadonlySet<string>;
  /**
   * Import sources whose declarations may be removed completely. Other
   * sources are retained as side-effect-only imports when their last binding
   * is consumed by static extraction.
   */
  sideEffectFreeSources?: ReadonlySet<string>;
};

export type CollectRuntimeIdentifierReferencesOptions = {
  typescript: TypeScriptAstApi | null;
  code: string;
  id: string;
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
    cleanId.endsWith(".ink") ||
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
  const reExports = new Map<string, ImportBinding>();
  const exportAllSources: string[] = [];
  let defaultExportExpression: string | null = null;

  if (!typescript) {
    return {
      imports,
      constInitializers,
      functionDeclarations,
      exportedConsts,
      reExports,
      exportAllSources,
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
        exportClause?: { kind?: number; elements?: unknown[]; name?: unknown };
        moduleSpecifier?: unknown;
      };
      if (exportNode.isTypeOnly === true) {
        return;
      }

      const source = astStringLiteralText(exportNode.moduleSpecifier);
      if (source) {
        if (!exportNode.exportClause) {
          exportAllSources.push(source);
          return;
        }

        if (exportNode.exportClause.kind === syntaxKind.NamespaceExport) {
          const exported = astIdentifierText(exportNode.exportClause.name);
          if (exported) {
            reExports.set(exported, { source, kind: "namespace" });
          }
          return;
        }

        if (exportNode.exportClause.kind === syntaxKind.NamedExports) {
          for (const element of exportNode.exportClause.elements ?? []) {
            if (isTypeOnlyNode(element)) {
              continue;
            }
            const exported = astIdentifierText(
              (element as { name?: unknown }).name,
            );
            const imported = astIdentifierText(
              (element as { propertyName?: unknown }).propertyName,
            ) ?? exported;
            if (exported && imported) {
              reExports.set(exported, { source, kind: "named", imported });
            }
          }
        }
        return;
      }

      if (exportNode.exportClause?.kind === syntaxKind.NamedExports) {
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
    reExports,
    exportAllSources,
    defaultExportExpression,
  };
}

function unwrapAstExpression(
  node: unknown,
  typescript: TypeScriptAstApi,
): unknown {
  const syntaxKind = typescript.SyntaxKind;
  const seen = new Set<unknown>();
  let current = node;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const kind = (current as { kind?: number }).kind;
    if (
      kind !== syntaxKind.ParenthesizedExpression &&
      kind !== syntaxKind.AsExpression &&
      kind !== syntaxKind.SatisfiesExpression &&
      kind !== syntaxKind.TypeAssertionExpression &&
      kind !== syntaxKind.NonNullExpression
    ) {
      break;
    }

    const expression = (current as { expression?: unknown }).expression;
    if (!expression) {
      break;
    }
    current = expression;
  }

  return current;
}

function astStaticPropertyName(
  node: unknown,
  typescript: TypeScriptAstApi,
): string | null {
  const syntaxKind = typescript.SyntaxKind;
  const unwrapped = unwrapAstExpression(node, typescript);
  if (!unwrapped || typeof unwrapped !== "object") {
    return null;
  }

  const kind = (unwrapped as { kind?: number }).kind;
  if (
    kind === syntaxKind.Identifier ||
    kind === syntaxKind.StringLiteral ||
    kind === syntaxKind.NumericLiteral ||
    kind === syntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return astIdentifierText(unwrapped);
  }

  if (kind !== syntaxKind.ComputedPropertyName) {
    return null;
  }

  const expression = unwrapAstExpression(
    (unwrapped as { expression?: unknown }).expression,
    typescript,
  );
  if (!expression || typeof expression !== "object") {
    return null;
  }
  const expressionKind = (expression as { kind?: number }).kind;
  if (
    expressionKind !== syntaxKind.StringLiteral &&
    expressionKind !== syntaxKind.NumericLiteral &&
    expressionKind !== syntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return null;
  }
  return astIdentifierText(expression);
}

function astSimpleIdentifierPath(
  node: unknown,
  typescript: TypeScriptAstApi,
): string[] | null {
  const syntaxKind = typescript.SyntaxKind;
  const unwrapped = unwrapAstExpression(node, typescript);
  if (!unwrapped || typeof unwrapped !== "object") {
    return null;
  }

  const kind = (unwrapped as { kind?: number }).kind;
  if (kind === syntaxKind.Identifier) {
    const name = astIdentifierText(unwrapped);
    return name ? [name] : null;
  }

  if (kind === syntaxKind.PropertyAccessExpression) {
    const access = unwrapped as {
      expression?: unknown;
      name?: unknown;
      questionDotToken?: unknown;
    };
    if (access.questionDotToken) {
      return null;
    }
    const parentPath = astSimpleIdentifierPath(access.expression, typescript);
    const name = astIdentifierText(access.name);
    return parentPath && name ? [...parentPath, name] : null;
  }

  if (kind === syntaxKind.ElementAccessExpression) {
    const access = unwrapped as {
      expression?: unknown;
      argumentExpression?: unknown;
      questionDotToken?: unknown;
    };
    if (access.questionDotToken) {
      return null;
    }
    const parentPath = astSimpleIdentifierPath(access.expression, typescript);
    const name = astStaticPropertyName(
      access.argumentExpression,
      typescript,
    );
    return parentPath && name ? [...parentPath, name] : null;
  }

  return null;
}

/**
 * Finds a property expression on an ink.config module's default object export.
 * Returns null when the default export cannot be followed without evaluation.
 */
export function extractInkConfigPropertyExpression(
  options: ExtractInkConfigPropertyExpressionOptions,
): AstInkConfigPropertyExpression | null {
  const typescript = options.typescript;
  if (!typescript || options.property.length === 0) {
    return null;
  }

  let sourceFile: Record<string, unknown>;
  try {
    sourceFile = createSourceFile(typescript, options.code, options.id);
  } catch {
    return null;
  }

  const statements = sourceFile.statements;
  if (!Array.isArray(statements)) {
    return null;
  }

  const syntaxKind = typescript.SyntaxKind;
  const initializers = new Map<string, unknown>();
  const ambiguousBindings = new Set<string>();
  const defineInkConfigBindings = new Set(["defineInkConfig"]);
  let defaultExportExpression: unknown = null;
  let ambiguousDefaultExport = false;

  const registerDefaultExport = (expression: unknown): void => {
    if (defaultExportExpression) {
      ambiguousDefaultExport = true;
      return;
    }
    defaultExportExpression = expression;
  };

  for (const statement of statements) {
    if (!statement || typeof statement !== "object") {
      continue;
    }
    const kind = (statement as { kind?: number }).kind;

    if (kind === syntaxKind.ImportDeclaration) {
      const clause = (statement as {
        importClause?: { isTypeOnly?: boolean; namedBindings?: unknown };
      }).importClause;
      if (clause?.isTypeOnly === true) {
        continue;
      }
      const namedBindings = clause?.namedBindings as {
        kind?: number;
        elements?: unknown[];
      } | undefined;
      if (namedBindings?.kind !== syntaxKind.NamedImports) {
        continue;
      }
      for (const element of namedBindings.elements ?? []) {
        if (isTypeOnlyNode(element)) {
          continue;
        }
        const imported = astIdentifierText(
          (element as { propertyName?: unknown }).propertyName,
        ) ?? astIdentifierText((element as { name?: unknown }).name);
        const local = astIdentifierText((element as { name?: unknown }).name);
        if (imported === "defineInkConfig" && local) {
          defineInkConfigBindings.add(local);
        }
      }
      continue;
    }

    if (kind === syntaxKind.VariableStatement) {
      const declarations =
        (statement as { declarationList?: { declarations?: unknown[] } })
          .declarationList?.declarations;
      for (const declaration of declarations ?? []) {
        const declarationNode = declaration as {
          name?: unknown;
          initializer?: unknown;
        };
        const name = astIdentifierText(declarationNode.name);
        if (!name || !declarationNode.initializer) {
          continue;
        }
        if (initializers.has(name)) {
          initializers.delete(name);
          ambiguousBindings.add(name);
          continue;
        }
        if (!ambiguousBindings.has(name)) {
          initializers.set(name, declarationNode.initializer);
        }
      }
      continue;
    }

    if (kind === syntaxKind.ExportAssignment) {
      const exportNode = statement as {
        isExportEquals?: boolean;
        expression?: unknown;
      };
      if (exportNode.isExportEquals !== true && exportNode.expression) {
        registerDefaultExport(exportNode.expression);
      }
      continue;
    }

    if (kind === syntaxKind.ExportDeclaration) {
      const exportNode = statement as {
        isTypeOnly?: boolean;
        exportClause?: { kind?: number; elements?: unknown[] };
        moduleSpecifier?: unknown;
      };
      if (
        exportNode.isTypeOnly === true ||
        exportNode.moduleSpecifier ||
        exportNode.exportClause?.kind !== syntaxKind.NamedExports
      ) {
        continue;
      }
      for (const element of exportNode.exportClause.elements ?? []) {
        if (
          isTypeOnlyNode(element) ||
          astIdentifierText((element as { name?: unknown }).name) !== "default"
        ) {
          continue;
        }
        const localName = (element as { propertyName?: unknown }).propertyName;
        if (localName) {
          registerDefaultExport(localName);
        }
      }
    }
  }

  if (!defaultExportExpression || ambiguousDefaultExport) {
    return null;
  }

  const resolvingBindings = new Set<string>();
  const resolveConfigObject = (node: unknown): unknown | null => {
    const expression = unwrapAstExpression(node, typescript);
    if (!expression || typeof expression !== "object") {
      return null;
    }

    const kind = (expression as { kind?: number }).kind;
    if (kind === syntaxKind.ObjectLiteralExpression) {
      return expression;
    }

    if (kind === syntaxKind.Identifier) {
      const name = astIdentifierText(expression);
      if (
        !name ||
        ambiguousBindings.has(name) ||
        resolvingBindings.has(name)
      ) {
        return null;
      }
      const initializer = initializers.get(name);
      if (!initializer) {
        return null;
      }
      resolvingBindings.add(name);
      const object = resolveConfigObject(initializer);
      resolvingBindings.delete(name);
      return object;
    }

    if (kind !== syntaxKind.CallExpression) {
      return null;
    }

    const call = expression as {
      expression?: unknown;
      arguments?: unknown[];
      questionDotToken?: unknown;
    };
    if (
      call.questionDotToken ||
      !Array.isArray(call.arguments) ||
      call.arguments.length !== 1
    ) {
      return null;
    }
    const calleePath = astSimpleIdentifierPath(call.expression, typescript);
    const isDefineInkConfig = calleePath?.length === 1
      ? defineInkConfigBindings.has(calleePath[0])
      : calleePath?.[calleePath.length - 1] === "defineInkConfig";
    return isDefineInkConfig ? resolveConfigObject(call.arguments[0]) : null;
  };

  const configObject = resolveConfigObject(defaultExportExpression) as {
    properties?: unknown[];
  } | null;
  if (!configObject || !Array.isArray(configObject.properties)) {
    return null;
  }

  let propertyExpression: unknown = null;
  for (const property of configObject.properties) {
    if (!property || typeof property !== "object") {
      propertyExpression = null;
      continue;
    }
    const kind = (property as { kind?: number }).kind;
    if (kind === syntaxKind.SpreadAssignment) {
      propertyExpression = null;
      continue;
    }

    const propertyName = astStaticPropertyName(
      (property as { name?: unknown }).name,
      typescript,
    );
    if (propertyName === null) {
      propertyExpression = null;
      continue;
    }
    if (propertyName !== options.property) {
      continue;
    }

    if (kind === syntaxKind.PropertyAssignment) {
      propertyExpression =
        (property as { initializer?: unknown }).initializer ??
          null;
      continue;
    }
    if (
      kind === syntaxKind.ShorthandPropertyAssignment &&
      !(property as { objectAssignmentInitializer?: unknown })
        .objectAssignmentInitializer
    ) {
      propertyExpression = (property as { name?: unknown }).name ?? null;
      continue;
    }
    propertyExpression = null;
  }

  if (!propertyExpression) {
    return null;
  }
  const expressionSource = astNodeText(
    propertyExpression,
    options.code,
    sourceFile,
  ).trim();
  if (!expressionSource) {
    return null;
  }

  return {
    expressionSource,
    identifierPath: astSimpleIdentifierPath(propertyExpression, typescript),
  };
}

type AstRuntimeImportBinding = {
  localName: string;
  node: unknown;
};

type AstNamedImportBinding = AstRuntimeImportBinding & {
  typeOnly: boolean;
};

type AstRuntimeImportPlan = {
  statement: unknown;
  clause: unknown;
  moduleSpecifier: unknown;
  moduleSource: string;
  defaultBinding: AstRuntimeImportBinding | null;
  namespaceBinding: AstRuntimeImportBinding | null;
  namedBindingsNode: unknown | null;
  namedBindings: AstNamedImportBinding[];
  rewritable: boolean;
};

function addAstBindingNames(
  node: unknown,
  names: Set<string>,
  typescript: TypeScriptAstApi,
): void {
  if (!node || typeof node !== "object") {
    return;
  }

  const syntaxKind = typescript.SyntaxKind;
  const kind = (node as { kind?: number }).kind;
  if (kind === syntaxKind.Identifier) {
    const name = astIdentifierText(node);
    if (name) {
      names.add(name);
    }
    return;
  }

  if (
    kind !== syntaxKind.ObjectBindingPattern &&
    kind !== syntaxKind.ArrayBindingPattern
  ) {
    return;
  }
  const elements = (node as { elements?: unknown[] }).elements;
  for (const element of elements ?? []) {
    addAstBindingNames(
      (element as { name?: unknown } | null)?.name,
      names,
      typescript,
    );
  }
}

function addAstStatementValueBindings(
  statement: unknown,
  names: Set<string>,
  typescript: TypeScriptAstApi,
): void {
  if (!statement || typeof statement !== "object") {
    return;
  }

  const syntaxKind = typescript.SyntaxKind;
  const kind = (statement as { kind?: number }).kind;
  if (kind === syntaxKind.VariableStatement) {
    const declarations =
      (statement as { declarationList?: { declarations?: unknown[] } })
        .declarationList?.declarations;
    for (const declaration of declarations ?? []) {
      addAstBindingNames(
        (declaration as { name?: unknown }).name,
        names,
        typescript,
      );
    }
    return;
  }

  if (
    kind === syntaxKind.FunctionDeclaration ||
    kind === syntaxKind.ClassDeclaration ||
    kind === syntaxKind.EnumDeclaration ||
    kind === syntaxKind.ModuleDeclaration
  ) {
    addAstBindingNames(
      (statement as { name?: unknown }).name,
      names,
      typescript,
    );
  }
}

function astValueScopeBindings(
  node: unknown,
  typescript: TypeScriptAstApi,
): Set<string> | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  const syntaxKind = typescript.SyntaxKind;
  const kind = (node as { kind?: number }).kind;
  const names = new Set<string>();

  if (
    kind === syntaxKind.FunctionDeclaration ||
    kind === syntaxKind.FunctionExpression ||
    kind === syntaxKind.ArrowFunction ||
    kind === syntaxKind.MethodDeclaration ||
    kind === syntaxKind.GetAccessor ||
    kind === syntaxKind.SetAccessor ||
    kind === syntaxKind.Constructor
  ) {
    const functionNode = node as {
      name?: unknown;
      parameters?: unknown[];
    };
    addAstBindingNames(functionNode.name, names, typescript);
    for (const parameter of functionNode.parameters ?? []) {
      addAstBindingNames(
        (parameter as { name?: unknown }).name,
        names,
        typescript,
      );
    }
    return names;
  }

  if (
    kind === syntaxKind.Block ||
    kind === syntaxKind.ModuleBlock ||
    kind === syntaxKind.ClassStaticBlockDeclaration
  ) {
    for (
      const statement of (node as { statements?: unknown[] }).statements ??
        []
    ) {
      addAstStatementValueBindings(statement, names, typescript);
    }
    return names;
  }

  if (kind === syntaxKind.CaseBlock) {
    for (const clause of (node as { clauses?: unknown[] }).clauses ?? []) {
      for (
        const statement of (clause as { statements?: unknown[] }).statements ??
          []
      ) {
        addAstStatementValueBindings(statement, names, typescript);
      }
    }
    return names;
  }

  if (kind === syntaxKind.CatchClause) {
    addAstBindingNames(
      (node as { variableDeclaration?: { name?: unknown } })
        .variableDeclaration?.name,
      names,
      typescript,
    );
    return names;
  }

  if (
    kind === syntaxKind.ForStatement ||
    kind === syntaxKind.ForInStatement ||
    kind === syntaxKind.ForOfStatement
  ) {
    const initializer = (node as { initializer?: unknown }).initializer as {
      kind?: number;
      declarations?: unknown[];
    } | undefined;
    if (initializer?.kind === syntaxKind.VariableDeclarationList) {
      for (const declaration of initializer.declarations ?? []) {
        addAstBindingNames(
          (declaration as { name?: unknown }).name,
          names,
          typescript,
        );
      }
    }
    return names;
  }

  if (
    kind === syntaxKind.ClassDeclaration ||
    kind === syntaxKind.ClassExpression
  ) {
    addAstBindingNames(
      (node as { name?: unknown }).name,
      names,
      typescript,
    );
    return names;
  }

  return null;
}

function astIdentifierIsReference(
  node: unknown,
  typescript: TypeScriptAstApi,
): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  const parent = (node as { parent?: unknown }).parent;
  if (!parent || typeof parent !== "object") {
    return false;
  }

  const syntaxKind = typescript.SyntaxKind;
  const kind = (parent as { kind?: number }).kind;
  const namedParent = parent as { name?: unknown };

  if (kind === syntaxKind.ShorthandPropertyAssignment) {
    return namedParent.name === node;
  }

  if (kind === syntaxKind.BindingElement) {
    const bindingElement = parent as {
      name?: unknown;
      propertyName?: unknown;
    };
    return bindingElement.name !== node && bindingElement.propertyName !== node;
  }

  if (kind === syntaxKind.ExportSpecifier) {
    const exportSpecifier = parent as {
      name?: unknown;
      propertyName?: unknown;
      parent?: { parent?: { moduleSpecifier?: unknown } };
    };
    if (exportSpecifier.parent?.parent?.moduleSpecifier) {
      return false;
    }
    return exportSpecifier.propertyName
      ? exportSpecifier.propertyName === node
      : exportSpecifier.name === node;
  }

  if (
    (kind === syntaxKind.PropertyAccessExpression &&
      namedParent.name === node) ||
    (kind === syntaxKind.QualifiedName &&
      (parent as { right?: unknown }).right === node) ||
    (kind === syntaxKind.PropertyAssignment && namedParent.name === node) ||
    (kind === syntaxKind.PropertyDeclaration && namedParent.name === node) ||
    (kind === syntaxKind.PropertySignature && namedParent.name === node) ||
    (kind === syntaxKind.MethodDeclaration && namedParent.name === node) ||
    (kind === syntaxKind.MethodSignature && namedParent.name === node) ||
    (kind === syntaxKind.GetAccessor && namedParent.name === node) ||
    (kind === syntaxKind.SetAccessor && namedParent.name === node) ||
    (kind === syntaxKind.EnumMember && namedParent.name === node) ||
    (kind === syntaxKind.NamedTupleMember && namedParent.name === node) ||
    (kind === syntaxKind.JsxAttribute && namedParent.name === node) ||
    (kind === syntaxKind.MetaProperty && namedParent.name === node) ||
    (kind === syntaxKind.TypePredicate &&
      (parent as { parameterName?: unknown }).parameterName === node) ||
    (kind === syntaxKind.LabeledStatement &&
      (parent as { label?: unknown }).label === node) ||
    (kind === syntaxKind.BreakStatement &&
      (parent as { label?: unknown }).label === node) ||
    (kind === syntaxKind.ContinueStatement &&
      (parent as { label?: unknown }).label === node)
  ) {
    return false;
  }

  if (
    kind === syntaxKind.VariableDeclaration ||
    kind === syntaxKind.Parameter ||
    kind === syntaxKind.FunctionDeclaration ||
    kind === syntaxKind.FunctionExpression ||
    kind === syntaxKind.ClassDeclaration ||
    kind === syntaxKind.ClassExpression ||
    kind === syntaxKind.InterfaceDeclaration ||
    kind === syntaxKind.TypeAliasDeclaration ||
    kind === syntaxKind.EnumDeclaration ||
    kind === syntaxKind.ModuleDeclaration ||
    kind === syntaxKind.TypeParameter ||
    kind === syntaxKind.ImportEqualsDeclaration
  ) {
    return namedParent.name !== node;
  }

  return true;
}

function astIdentifierIsRuntimeReference(
  node: unknown,
  typescript: TypeScriptAstApi,
): boolean {
  if (!astIdentifierIsReference(node, typescript)) {
    return false;
  }

  const syntaxKind = typescript.SyntaxKind;
  let current = (node as { parent?: unknown }).parent;
  while (current && typeof current === "object") {
    const kind = (current as { kind?: number }).kind;
    if (
      (kind === syntaxKind.ExportSpecifier ||
        kind === syntaxKind.ExportDeclaration) &&
      (current as { isTypeOnly?: unknown }).isTypeOnly === true
    ) {
      return false;
    }
    if (
      kind === syntaxKind.InterfaceDeclaration ||
      kind === syntaxKind.TypeAliasDeclaration ||
      (kind === syntaxKind.HeritageClause &&
        (current as { token?: unknown }).token ===
          syntaxKind.ImplementsKeyword)
    ) {
      return false;
    }
    if (
      typeof kind === "number" &&
      kind >= syntaxKind.FirstTypeNode &&
      kind <= syntaxKind.LastTypeNode
    ) {
      return false;
    }
    current = (current as { parent?: unknown }).parent;
  }
  return true;
}

/** Collects root runtime identifiers referenced by a module or expression. */
export function collectRuntimeIdentifierReferences(
  options: CollectRuntimeIdentifierReferencesOptions,
): Set<string> | null {
  const typescript = options.typescript;
  if (!typescript) {
    return null;
  }

  let sourceFile: Record<string, unknown>;
  try {
    sourceFile = createSourceFile(typescript, options.code, options.id);
  } catch {
    return null;
  }
  const parseDiagnostics = sourceFile.parseDiagnostics;
  if (Array.isArray(parseDiagnostics) && parseDiagnostics.length > 0) {
    return null;
  }

  const syntaxKind = typescript.SyntaxKind;
  const references = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const kind = (node as { kind?: number }).kind;
    if (kind === syntaxKind.ImportDeclaration) {
      return;
    }
    if (kind === syntaxKind.Identifier) {
      const name = astIdentifierText(node);
      if (name && astIdentifierIsRuntimeReference(node, typescript)) {
        references.add(name);
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

/**
 * Returns replacements that remove explicitly allowed import bindings with no
 * runtime AST references. Null means the source could not be checked safely.
 */
export function collectUnusedRuntimeImportReplacements(
  options: CollectUnusedRuntimeImportReplacementsOptions,
): AstSourceReplacement[] | null {
  const typescript = options.typescript;
  const removableIdentifiers = options.removableIdentifiers;
  if (
    !typescript ||
    !removableIdentifiers ||
    typeof removableIdentifiers.has !== "function"
  ) {
    return null;
  }
  if (removableIdentifiers.size === 0) {
    return [];
  }

  let sourceFile: Record<string, unknown>;
  try {
    sourceFile = createSourceFile(typescript, options.code, options.id);
  } catch {
    return null;
  }
  const parseDiagnostics = sourceFile.parseDiagnostics;
  if (Array.isArray(parseDiagnostics) && parseDiagnostics.length > 0) {
    return null;
  }
  const statements = sourceFile.statements;
  if (!Array.isArray(statements)) {
    return null;
  }

  const syntaxKind = typescript.SyntaxKind;
  const plans: AstRuntimeImportPlan[] = [];
  const runtimeBindingCounts = new Map<string, number>();
  const registerRuntimeBinding = (binding: AstRuntimeImportBinding): void => {
    if (!removableIdentifiers.has(binding.localName)) {
      return;
    }
    runtimeBindingCounts.set(
      binding.localName,
      (runtimeBindingCounts.get(binding.localName) ?? 0) + 1,
    );
  };

  for (const statement of statements) {
    if (
      !statement ||
      typeof statement !== "object" ||
      (statement as { kind?: number }).kind !== syntaxKind.ImportDeclaration
    ) {
      continue;
    }
    const importNode = statement as {
      importClause?: unknown;
      moduleSpecifier?: unknown;
    };
    const clause = importNode.importClause as {
      isTypeOnly?: boolean;
      name?: unknown;
      namedBindings?: unknown;
    } | undefined;
    if (!clause || clause.isTypeOnly === true || !importNode.moduleSpecifier) {
      continue;
    }
    const moduleSource = astStringLiteralText(importNode.moduleSpecifier);
    if (moduleSource === null) {
      continue;
    }

    let rewritable = true;
    let defaultBinding: AstRuntimeImportBinding | null = null;
    if (clause.name) {
      const localName = astIdentifierText(clause.name);
      if (!localName) {
        rewritable = false;
      } else {
        defaultBinding = { localName, node: clause.name };
        registerRuntimeBinding(defaultBinding);
      }
    }

    let namespaceBinding: AstRuntimeImportBinding | null = null;
    let namedBindingsNode: unknown | null = null;
    const namedBindings: AstNamedImportBinding[] = [];
    const bindingsNode = clause.namedBindings as {
      kind?: number;
      name?: unknown;
      elements?: unknown[];
    } | undefined;
    if (bindingsNode?.kind === syntaxKind.NamespaceImport) {
      const localName = astIdentifierText(bindingsNode.name);
      if (!localName) {
        rewritable = false;
      } else {
        namespaceBinding = { localName, node: bindingsNode };
        registerRuntimeBinding(namespaceBinding);
      }
    } else if (bindingsNode?.kind === syntaxKind.NamedImports) {
      namedBindingsNode = bindingsNode;
      for (const element of bindingsNode.elements ?? []) {
        const localName = astIdentifierText(
          (element as { name?: unknown }).name,
        );
        if (!localName) {
          rewritable = false;
          continue;
        }
        const binding = {
          localName,
          node: element,
          typeOnly: isTypeOnlyNode(element),
        };
        namedBindings.push(binding);
        if (!binding.typeOnly) {
          registerRuntimeBinding(binding);
        }
      }
    } else if (bindingsNode) {
      rewritable = false;
    }

    const statementStart = astNodeStart(statement, sourceFile);
    const clauseStart = astNodeStart(clause, sourceFile);
    const moduleStart = astNodeStart(importNode.moduleSpecifier, sourceFile);
    const statementEnd = astNodeEnd(statement);
    if (
      statementStart < 0 ||
      clauseStart < statementStart ||
      moduleStart < clauseStart ||
      statementEnd < moduleStart ||
      options.code.slice(statementStart, clauseStart).trim() !== "import"
    ) {
      rewritable = false;
    }
    const bindingSource = options.code.slice(clauseStart, moduleStart);
    if (bindingSource.includes("//") || bindingSource.includes("/*")) {
      rewritable = false;
    }

    plans.push({
      statement,
      clause,
      moduleSpecifier: importNode.moduleSpecifier,
      moduleSource,
      defaultBinding,
      namespaceBinding,
      namedBindingsNode,
      namedBindings,
      rewritable,
    });
  }

  if (runtimeBindingCounts.size === 0) {
    return [];
  }

  const runtimeNames = new Set(runtimeBindingCounts.keys());
  const referenced = new Set<string>();
  for (const [name, count] of runtimeBindingCounts) {
    if (count > 1) {
      referenced.add(name);
    }
  }

  const visitReferences = (
    node: unknown,
    shadowed: ReadonlySet<string>,
  ): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const kind = (node as { kind?: number }).kind;
    if (kind === syntaxKind.ImportDeclaration) {
      return;
    }

    let activeShadowed = shadowed;
    if (node !== sourceFile) {
      const scopeBindings = astValueScopeBindings(node, typescript);
      if (scopeBindings?.size) {
        for (const name of scopeBindings) {
          if (!runtimeNames.has(name) || activeShadowed.has(name)) {
            continue;
          }
          if (activeShadowed === shadowed) {
            activeShadowed = new Set(shadowed);
          }
          (activeShadowed as Set<string>).add(name);
        }
      }
    }

    if (kind === syntaxKind.Identifier) {
      const name = astIdentifierText(node);
      if (
        name &&
        runtimeNames.has(name) &&
        !activeShadowed.has(name) &&
        astIdentifierIsRuntimeReference(node, typescript)
      ) {
        referenced.add(name);
      }
    }
    typescript.forEachChild(
      node,
      (child) => visitReferences(child, activeShadowed),
    );
  };
  visitReferences(sourceFile, new Set());

  const replacements: AstSourceReplacement[] = [];
  for (const plan of plans) {
    if (!plan.rewritable) {
      continue;
    }
    const keepDefault = plan.defaultBinding !== null &&
      (!removableIdentifiers.has(plan.defaultBinding.localName) ||
        referenced.has(plan.defaultBinding.localName));
    const keepNamespace = plan.namespaceBinding !== null &&
      (!removableIdentifiers.has(plan.namespaceBinding.localName) ||
        referenced.has(plan.namespaceBinding.localName));
    const keptNamedBindings = plan.namedBindings.filter((binding) =>
      binding.typeOnly ||
      !removableIdentifiers.has(binding.localName) ||
      referenced.has(binding.localName)
    );
    const removedRuntimeBinding =
      (plan.defaultBinding !== null && !keepDefault) ||
      (plan.namespaceBinding !== null && !keepNamespace) ||
      keptNamedBindings.length !== plan.namedBindings.length;
    if (!removedRuntimeBinding) {
      continue;
    }

    const statementStart = astNodeStart(plan.statement, sourceFile);
    const statementEnd = astNodeEnd(plan.statement);
    const keptParts: string[] = [];
    if (keepDefault && plan.defaultBinding) {
      keptParts.push(
        astNodeText(plan.defaultBinding.node, options.code, sourceFile),
      );
    }
    if (keepNamespace && plan.namespaceBinding) {
      keptParts.push(
        astNodeText(plan.namespaceBinding.node, options.code, sourceFile),
      );
    } else if (keptNamedBindings.length > 0 && plan.namedBindingsNode) {
      keptParts.push(
        `{ ${
          keptNamedBindings.map((binding) =>
            astNodeText(binding.node, options.code, sourceFile)
          ).join(", ")
        } }`,
      );
    }

    if (keptParts.length === 0) {
      const moduleStart = astNodeStart(plan.moduleSpecifier, sourceFile);
      const moduleAndAttributes = options.code.slice(moduleStart, statementEnd);
      replacements.push({
        start: statementStart,
        end: statementEnd,
        replacement: options.sideEffectFreeSources?.has(plan.moduleSource)
          ? ""
          : `import ${moduleAndAttributes}`,
      });
      continue;
    }

    const moduleStart = astNodeStart(plan.moduleSpecifier, sourceFile);
    const moduleAndAttributes = options.code.slice(moduleStart, statementEnd);
    replacements.push({
      start: statementStart,
      end: statementEnd,
      replacement: `import ${keptParts.join(", ")} from ${moduleAndAttributes}`,
    });
  }

  return replacements;
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
      call.arguments.length > 0,
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
