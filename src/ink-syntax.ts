/** Source offsets carried by every `.ink` syntax-tree node. */
export type InkSourceSpan = {
  start: number;
  end: number;
};

export type InkKeyNode = {
  kind: "key";
  value: string;
  quoted: boolean;
  span: InkSourceSpan;
};

export type InkObjectEntryNode = {
  kind: "entry";
  key: InkKeyNode;
  value: InkValueNode;
  span: InkSourceSpan;
};

export type InkObjectNode = {
  kind: "object";
  entries: InkObjectEntryNode[];
  span: InkSourceSpan;
};

export type InkArrayNode = {
  kind: "array";
  elements: InkValueNode[];
  span: InkSourceSpan;
};

export type InkCssLiteralNode = {
  kind: "css-literal";
  value: string;
  span: InkSourceSpan;
};

export type InkStringNode = {
  kind: "string";
  value: string;
  span: InkSourceSpan;
};

export type InkTemplateNode = {
  kind: "template";
  source: string;
  span: InkSourceSpan;
};

export type InkNumberNode = {
  kind: "number";
  raw: string;
  value: number;
  span: InkSourceSpan;
};

export type InkBooleanNode = {
  kind: "boolean";
  value: boolean;
  span: InkSourceSpan;
};

export type InkExpressionNode = {
  kind: "expression";
  source: string;
  span: InkSourceSpan;
};

export type InkNewExpressionNode = {
  kind: "new-expression";
  callee: string;
  argument: InkObjectNode;
  span: InkSourceSpan;
};

export type InkInterpolatedCssTextNode = {
  kind: "css-text";
  value: string;
  span: InkSourceSpan;
};

export type InkInterpolatedCssExpressionNode = {
  kind: "css-expression";
  source: string;
  span: InkSourceSpan;
};

export type InkInterpolatedCssNode = {
  kind: "interpolated-css";
  parts: Array<
    InkInterpolatedCssTextNode | InkInterpolatedCssExpressionNode
  >;
  span: InkSourceSpan;
};

export type InkValueNode =
  | InkObjectNode
  | InkArrayNode
  | InkCssLiteralNode
  | InkStringNode
  | InkTemplateNode
  | InkNumberNode
  | InkBooleanNode
  | InkExpressionNode
  | InkNewExpressionNode
  | InkInterpolatedCssNode;

export type InkRawModuleNode = {
  kind: "raw-module";
  source: string;
  span: InkSourceSpan;
};

export type InkConstDeclarationNode = {
  kind: "const-declaration";
  name: string;
  value: InkValueNode;
  span: InkSourceSpan;
};

export type InkModulePreambleNode =
  | InkRawModuleNode
  | InkConstDeclarationNode;

export type InkModuleNode = {
  kind: "module";
  prefix: string;
  preamble: InkModulePreambleNode[];
  defaultExport: InkObjectNode;
  suffix: string;
  span: InkSourceSpan;
};

export type CompileInkModuleResult = {
  code: string;
  ast: InkModuleNode;
  map: null;
};

/** A syntax error with the original `.ink` source location. */
export class InkSyntaxError extends SyntaxError {
  readonly id: string;
  readonly index: number;
  readonly line: number;
  readonly column: number;

  constructor(message: string, source: string, id: string, index: number) {
    const location = sourceLocationAt(source, index);
    super(`${id}:${location.line}:${location.column}: ${message}`);
    this.name = "InkSyntaxError";
    this.id = id;
    this.index = index;
    this.line = location.line;
    this.column = location.column;
  }
}

type ModuleExportLocation = {
  exportStart: number;
  objectStart: number;
};

type ParsedString = {
  value: string;
  end: number;
};

type SeparatorResult = {
  sawComma: boolean;
  sawNewline: boolean;
};

type ValueContext = "object" | "array" | "module";

function sourceLocationAt(
  source: string,
  index: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(index, 0), source.length);
  for (let cursor = 0; cursor < end; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function isHorizontalWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\f" || char === "\v";
}

function isNewline(char: string | undefined): boolean {
  return char === "\n" || char === "\r";
}

function isIdentifierStart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "_" ||
    char === "$"
  );
}

function isIdentifierPart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return isIdentifierStart(char) || (code >= 48 && code <= 57);
}

function isHexDigit(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

function readIdentifier(
  source: string,
  start: number,
): { value: string; end: number } {
  let end = start;
  while (end < source.length && isIdentifierPart(source[end])) {
    end += 1;
  }
  return { value: source.slice(start, end), end };
}

function skipLineComment(source: string, start: number): number {
  let cursor = start + 2;
  while (cursor < source.length && !isNewline(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function skipBlockComment(
  source: string,
  start: number,
  id: string,
): number {
  let cursor = start + 2;
  while (cursor < source.length) {
    if (source[cursor] === "*" && source[cursor + 1] === "/") {
      return cursor + 2;
    }
    cursor += 1;
  }
  throw new InkSyntaxError("Unterminated block comment", source, id, start);
}

function skipQuotedSource(
  source: string,
  start: number,
  id: string,
): number {
  const quote = source[start];
  let cursor = start + 1;
  let escaped = false;
  while (cursor < source.length) {
    const char = source[cursor];
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (char === quote) {
      return cursor + 1;
    }
    cursor += 1;
  }
  const label = quote === "`" ? "template literal" : "string literal";
  throw new InkSyntaxError(`Unterminated ${label}`, source, id, start);
}

function skipTriviaAt(
  source: string,
  start: number,
  id: string,
): number {
  let cursor = start;
  while (cursor < source.length) {
    if (isHorizontalWhitespace(source[cursor]) || isNewline(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      const commentEnd = skipBlockComment(source, cursor, id);
      let containsNewline = false;
      for (let index = cursor; index < commentEnd; index += 1) {
        if (isNewline(source[index])) {
          containsNewline = true;
          break;
        }
      }
      if (containsNewline) return cursor;
      cursor = commentEnd;
      continue;
    }
    break;
  }
  return cursor;
}

function findDefaultExport(
  source: string,
  id: string,
): ModuleExportLocation {
  let cursor = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor, id);
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      cursor = skipQuotedSource(source, cursor, id);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      cursor += 1;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      cursor += 1;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      cursor += 1;
      continue;
    }

    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      isIdentifierStart(char)
    ) {
      const token = readIdentifier(source, cursor);
      if (token.value === "export") {
        const defaultStart = skipTriviaAt(source, token.end, id);
        if (isIdentifierStart(source[defaultStart])) {
          const defaultToken = readIdentifier(source, defaultStart);
          if (defaultToken.value === "default") {
            const objectStart = skipTriviaAt(source, defaultToken.end, id);
            if (source[objectStart] !== "{") {
              throw new InkSyntaxError(
                "The default export of an .ink module must be an object",
                source,
                id,
                objectStart,
              );
            }
            return { exportStart: cursor, objectStart };
          }
        }
      }
      cursor = token.end;
      continue;
    }

    cursor += 1;
  }

  throw new InkSyntaxError(
    "Expected one default-exported style object",
    source,
    id,
    0,
  );
}

function parseEscapedString(
  source: string,
  start: number,
  id: string,
): ParsedString {
  const quote = source[start];
  let cursor = start + 1;
  let value = "";

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === quote) {
      return { value, end: cursor + 1 };
    }
    if (char !== "\\") {
      value += char;
      cursor += 1;
      continue;
    }

    const escape = source[cursor + 1];
    if (escape === undefined) break;
    const simpleEscapes: Record<string, string> = {
      "0": "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (escape in simpleEscapes) {
      value += simpleEscapes[escape];
      cursor += 2;
      continue;
    }

    if (escape === "u") {
      const digits = source.slice(cursor + 2, cursor + 6);
      if (digits.length === 4 && Array.from(digits).every(isHexDigit)) {
        value += String.fromCharCode(Number.parseInt(digits, 16));
        cursor += 6;
        continue;
      }
    }

    value += escape;
    cursor += 2;
  }

  throw new InkSyntaxError("Unterminated string literal", source, id, start);
}

function isPlainNumber(source: string): boolean {
  if (source.length === 0) return false;
  let cursor = 0;
  if (source[cursor] === "-") cursor += 1;
  let integerDigits = 0;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (code < 48 || code > 57) break;
    integerDigits += 1;
    cursor += 1;
  }

  let fractionDigits = 0;
  if (source[cursor] === ".") {
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code < 48 || code > 57) break;
      fractionDigits += 1;
      cursor += 1;
    }
  }
  if (integerDigits === 0 && fractionDigits === 0) return false;

  if (source[cursor] === "e" || source[cursor] === "E") {
    cursor += 1;
    if (source[cursor] === "+" || source[cursor] === "-") cursor += 1;
    let exponentDigits = 0;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code < 48 || code > 57) break;
      exponentDigits += 1;
      cursor += 1;
    }
    if (exponentDigits === 0) return false;
  }

  return cursor === source.length;
}

function trimValueBounds(
  source: string,
  start: number,
  end: number,
  trimObjectComma: boolean,
): InkSourceSpan {
  while (
    start < end &&
    (isHorizontalWhitespace(source[start]) || isNewline(source[start]))
  ) {
    start += 1;
  }
  while (
    end > start &&
    (isHorizontalWhitespace(source[end - 1]) || isNewline(source[end - 1]))
  ) {
    end -= 1;
  }
  if (trimObjectComma && source[end - 1] === ",") {
    end -= 1;
    while (
      end > start &&
      (isHorizontalWhitespace(source[end - 1]) || isNewline(source[end - 1]))
    ) {
      end -= 1;
    }
  }
  return { start, end };
}

function findLineContinuationMarker(
  source: string,
  lineEnd: number,
  valueStart: number,
): number | null {
  let marker = lineEnd - 1;
  while (marker >= valueStart && isHorizontalWhitespace(source[marker])) {
    marker -= 1;
  }
  if (marker < valueStart || source[marker] !== "_") return null;

  const previous = source[marker - 1];
  if (isIdentifierPart(previous) || previous === "-") return null;
  return marker;
}

function normalizeCssLineContinuations(value: string): string {
  let output = "";
  let cursor = 0;
  let lineStart = 0;

  while (cursor < value.length) {
    if (!isNewline(value[cursor])) {
      cursor += 1;
      continue;
    }

    const marker = findLineContinuationMarker(value, cursor, lineStart);
    if (marker === null) {
      cursor += value[cursor] === "\r" && value[cursor + 1] === "\n" ? 2 : 1;
      continue;
    }

    output += value.slice(lineStart, marker);
    cursor += value[cursor] === "\r" && value[cursor + 1] === "\n" ? 2 : 1;
    while (cursor < value.length && isHorizontalWhitespace(value[cursor])) {
      cursor += 1;
    }
    lineStart = cursor;
  }

  if (lineStart === 0) return value;
  return output + value.slice(lineStart);
}

function findMatchingDelimiter(
  source: string,
  openIndex: number,
  open: string,
  close: string,
  limit: number,
  id: string,
): number {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < limit) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === "`") {
      cursor = skipQuotedSource(source, cursor, id);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor, id);
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  throw new InkSyntaxError(
    `Unterminated '${open}${close}' expression segment`,
    source,
    id,
    openIndex,
  );
}

function canStartInlineCssExpression(previous: string | undefined): boolean {
  return previous === undefined ||
    isHorizontalWhitespace(previous) ||
    previous === "(" ||
    previous === "," ||
    previous === "+" ||
    previous === "-" ||
    previous === "*" ||
    previous === "/" ||
    previous === ":";
}

function readInlineCssExpression(
  source: string,
  equalsIndex: number,
  end: number,
  id: string,
): { source: string; end: number } | null {
  let cursor = equalsIndex + 1;
  let openIndex = cursor;
  if (source[cursor] === "$" && source[cursor + 1] === "{") {
    openIndex = cursor + 1;
  }
  if (source[openIndex] === "{") {
    const closeIndex = findMatchingDelimiter(
      source,
      openIndex,
      "{",
      "}",
      end,
      id,
    );
    const expressionBounds = trimValueBounds(
      source,
      openIndex + 1,
      closeIndex,
      false,
    );
    if (expressionBounds.start === expressionBounds.end) {
      throw new InkSyntaxError(
        "Inline CSS expressions cannot be empty",
        source,
        id,
        equalsIndex,
      );
    }
    return {
      source: source.slice(expressionBounds.start, expressionBounds.end),
      end: closeIndex + 1,
    };
  }

  if (!isIdentifierStart(source[cursor])) return null;
  cursor = readIdentifier(source, cursor).end;
  while (cursor < end) {
    if (
      source[cursor] === "." &&
      isIdentifierStart(source[cursor + 1])
    ) {
      cursor = readIdentifier(source, cursor + 1).end;
      continue;
    }
    if (
      source[cursor] === "?" &&
      source[cursor + 1] === "." &&
      isIdentifierStart(source[cursor + 2])
    ) {
      cursor = readIdentifier(source, cursor + 2).end;
      continue;
    }
    if (source[cursor] === "[") {
      cursor = findMatchingDelimiter(
        source,
        cursor,
        "[",
        "]",
        end,
        id,
      ) + 1;
      continue;
    }
    if (source[cursor] === "(") {
      cursor = findMatchingDelimiter(
        source,
        cursor,
        "(",
        ")",
        end,
        id,
      ) + 1;
      continue;
    }
    break;
  }
  return {
    source: source.slice(equalsIndex + 1, cursor),
    end: cursor,
  };
}

function parseInterpolatedCss(
  source: string,
  start: number,
  end: number,
  id: string,
): InkInterpolatedCssNode | null {
  const parts: InkInterpolatedCssNode["parts"] = [];
  let cursor = start;
  let textStart = start;
  while (cursor < end) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === "`") {
      cursor = skipQuotedSource(source, cursor, id);
      continue;
    }
    if (
      char !== "=" ||
      source[cursor + 1] === ">" ||
      !canStartInlineCssExpression(source[cursor - 1])
    ) {
      cursor += 1;
      continue;
    }

    const expression = readInlineCssExpression(source, cursor, end, id);
    if (!expression) {
      throw new InkSyntaxError(
        "Expected an identifier or braced expression after inline '='",
        source,
        id,
        cursor,
      );
    }
    if (textStart < cursor) {
      parts.push({
        kind: "css-text",
        value: normalizeCssLineContinuations(
          source.slice(textStart, cursor),
        ),
        span: { start: textStart, end: cursor },
      });
    }
    parts.push({
      kind: "css-expression",
      source: expression.source,
      span: { start: cursor, end: expression.end },
    });
    cursor = expression.end;
    textStart = cursor;
  }

  if (parts.length === 0) return null;
  if (textStart < end) {
    parts.push({
      kind: "css-text",
      value: normalizeCssLineContinuations(source.slice(textStart, end)),
      span: { start: textStart, end },
    });
  }
  return {
    kind: "interpolated-css",
    parts,
    span: { start, end },
  };
}

class InkParser {
  private index: number;

  constructor(
    private readonly source: string,
    private readonly id: string,
    start: number,
  ) {
    this.index = start;
  }

  get position(): number {
    return this.index;
  }

  parseModuleValue(): InkValueNode {
    return this.parseValue("module");
  }

  parseObject(): InkObjectNode {
    const start = this.index;
    this.expect("{", "Expected '{' to open a style object");
    this.index += 1;
    const entries: InkObjectEntryNode[] = [];

    this.skipSeparators(true);
    while (this.index < this.source.length && this.source[this.index] !== "}") {
      entries.push(this.parseEntry());
      const separators = this.skipSeparators(false);
      if (this.source[this.index] === "}") break;
      if (!separators.sawComma && !separators.sawNewline) {
        throw this.error(
          "Object entries must be separated by a newline or comma",
          this.index,
        );
      }
    }

    this.expect("}", "Unterminated style object");
    this.index += 1;
    return {
      kind: "object",
      entries,
      span: { start, end: this.index },
    };
  }

  private parseEntry(): InkObjectEntryNode {
    const start = this.index;
    const colon = this.findEntryColon();
    let keyStart = start;
    while (
      keyStart < colon &&
      (isHorizontalWhitespace(this.source[keyStart]) ||
        isNewline(this.source[keyStart]))
    ) {
      keyStart += 1;
    }
    let keyEnd = colon;
    while (
      keyEnd > keyStart &&
      (isHorizontalWhitespace(this.source[keyEnd - 1]) ||
        isNewline(this.source[keyEnd - 1]))
    ) {
      keyEnd -= 1;
    }
    const rawKey = this.source.slice(keyStart, keyEnd);
    if (rawKey.length === 0) {
      throw this.error("Style keys and selectors cannot be empty", start);
    }

    let keyValue = rawKey;
    let quoted = false;
    if (
      (rawKey[0] === '"' || rawKey[0] === "'") &&
      rawKey[rawKey.length - 1] === rawKey[0]
    ) {
      const parsedKey = parseEscapedString(this.source, keyStart, this.id);
      if (parsedKey.end !== keyEnd) {
        throw this.error("Unexpected text after quoted style key", keyStart);
      }
      keyValue = parsedKey.value;
      quoted = true;
    }

    const key: InkKeyNode = {
      kind: "key",
      value: keyValue,
      quoted,
      span: { start: keyStart, end: keyStart + rawKey.length },
    };

    this.index = colon + 1;
    this.skipValueTrivia();
    const value = this.source[this.index] === "{"
      ? this.parseObject()
      : this.parseValue("object");

    return {
      kind: "entry",
      key,
      value,
      span: { start, end: value.span.end },
    };
  }

  private findEntryColon(): number {
    let cursor = this.index;
    let firstColon = -1;
    let parenDepth = 0;
    let bracketDepth = 0;

    while (cursor < this.source.length) {
      const char = this.source[cursor];
      if (char === '"' || char === "'" || char === "`") {
        cursor = skipQuotedSource(this.source, cursor, this.id);
        continue;
      }
      if (char === "/" && this.source[cursor + 1] === "*") {
        cursor = skipBlockComment(this.source, cursor, this.id);
        continue;
      }
      if (char === "/" && this.source[cursor + 1] === "/") {
        break;
      }
      if (char === "(") {
        parenDepth += 1;
        cursor += 1;
        continue;
      }
      if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        cursor += 1;
        continue;
      }
      if (char === "[") {
        bracketDepth += 1;
        cursor += 1;
        continue;
      }
      if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        cursor += 1;
        continue;
      }
      if (isNewline(char) && parenDepth === 0 && bracketDepth === 0) {
        break;
      }
      if (char === "}" && parenDepth === 0 && bracketDepth === 0) {
        break;
      }
      if (char === ":" && parenDepth === 0 && bracketDepth === 0) {
        if (firstColon === -1) firstColon = cursor;
        const valueStart = skipInlineTriviaAt(
          this.source,
          cursor + 1,
          this.source.length,
          this.id,
        );
        if (this.source[valueStart] === "{") return cursor;
      }
      cursor += 1;
    }

    if (firstColon !== -1) return firstColon;
    throw this.error("Expected ':' after style key or selector", this.index);
  }

  private parseValue(context: ValueContext): InkValueNode {
    this.skipValueTrivia();
    const start = this.index;
    const char = this.source[this.index];

    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();

    if (char === "n") {
      const newExpression = this.tryParseNewObjectExpression();
      if (newExpression) return newExpression;
    }

    if (char === '"' || char === "'") {
      const parsed = parseEscapedString(this.source, start, this.id);
      this.index = parsed.end;
      return {
        kind: "string",
        value: parsed.value,
        span: { start, end: this.index },
      };
    }

    if (char === "`") {
      this.index = skipQuotedSource(this.source, start, this.id);
      return {
        kind: "template",
        source: this.source.slice(start, this.index),
        span: { start, end: this.index },
      };
    }

    const expression = char === "=";
    if (expression) this.index += 1;
    const contentStart = this.index;
    const contentEnd = this.readValueEnd(context);
    const contentBounds = trimValueBounds(
      this.source,
      contentStart,
      contentEnd,
      context === "object",
    );
    const raw = this.source.slice(contentBounds.start, contentBounds.end);
    if (raw.length === 0) {
      throw this.error(
        expression
          ? "Expected an expression after '='"
          : "Expected a style value",
        contentStart,
      );
    }
    this.index = contentEnd;

    if (expression) {
      return {
        kind: "expression",
        source: raw,
        span: { start, end: contentBounds.end },
      };
    }
    if (raw === "true" || raw === "false") {
      return {
        kind: "boolean",
        value: raw === "true",
        span: { start, end: contentBounds.end },
      };
    }
    if (isPlainNumber(raw)) {
      return {
        kind: "number",
        raw,
        value: Number(raw),
        span: { start, end: contentBounds.end },
      };
    }
    const interpolated = parseInterpolatedCss(
      this.source,
      contentBounds.start,
      contentBounds.end,
      this.id,
    );
    if (interpolated) return interpolated;
    return {
      kind: "css-literal",
      value: normalizeCssLineContinuations(raw),
      span: { start, end: contentBounds.end },
    };
  }

  private tryParseNewObjectExpression(): InkNewExpressionNode | null {
    const start = this.index;
    const newToken = readIdentifier(this.source, start);
    if (newToken.value !== "new") return null;

    let cursor = skipInlineTriviaAt(
      this.source,
      newToken.end,
      this.source.length,
      this.id,
    );
    if (!isIdentifierStart(this.source[cursor])) return null;
    const calleeToken = readIdentifier(this.source, cursor);
    cursor = skipInlineTriviaAt(
      this.source,
      calleeToken.end,
      this.source.length,
      this.id,
    );
    if (this.source[cursor] !== "(") return null;

    this.index = cursor + 1;
    this.skipValueTrivia();
    if (this.source[this.index] !== "{") {
      this.index = start;
      return null;
    }

    const argument = this.parseObject();
    this.skipValueTrivia();
    this.expect(")", "Expected ')' after constructor object");
    this.index += 1;

    return {
      kind: "new-expression",
      callee: calleeToken.value,
      argument,
      span: { start, end: this.index },
    };
  }

  private parseArray(): InkArrayNode {
    const start = this.index;
    this.index += 1;
    const elements: InkValueNode[] = [];
    this.skipValueTrivia();

    while (this.index < this.source.length && this.source[this.index] !== "]") {
      elements.push(this.parseValue("array"));
      this.skipValueTrivia();
      if (this.source[this.index] === "]") break;
      this.expect(",", "Array values must be separated by commas");
      this.index += 1;
      this.skipValueTrivia();
    }

    this.expect("]", "Unterminated array value");
    this.index += 1;
    return {
      kind: "array",
      elements,
      span: { start, end: this.index },
    };
  }

  private readValueEnd(context: ValueContext): number {
    let cursor = this.index;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (cursor < this.source.length) {
      const char = this.source[cursor];
      if (char === '"' || char === "'" || char === "`") {
        cursor = skipQuotedSource(this.source, cursor, this.id);
        continue;
      }
      if (
        char === "/" &&
        this.source[cursor + 1] === "/" &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        return cursor;
      }
      if (
        char === "/" &&
        this.source[cursor + 1] === "*" &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        return cursor;
      }
      if (char === "(") {
        parenDepth += 1;
        cursor += 1;
        continue;
      }
      if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        cursor += 1;
        continue;
      }
      if (char === "[") {
        bracketDepth += 1;
        cursor += 1;
        continue;
      }
      if (char === "]") {
        if (
          context === "array" &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0
        ) {
          return cursor;
        }
        bracketDepth = Math.max(0, bracketDepth - 1);
        cursor += 1;
        continue;
      }
      if (char === "{") {
        braceDepth += 1;
        cursor += 1;
        continue;
      }
      if (char === "}") {
        if (
          context === "object" &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0
        ) {
          return cursor;
        }
        braceDepth = Math.max(0, braceDepth - 1);
        cursor += 1;
        continue;
      }
      if (
        context === "array" &&
        char === "," &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        return cursor;
      }
      if (
        context === "module" &&
        char === ";" &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        return cursor;
      }
      if (
        (context === "object" || context === "module") &&
        isNewline(char) &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        if (
          findLineContinuationMarker(
            this.source,
            cursor,
            this.index,
          ) !== null
        ) {
          cursor += char === "\r" && this.source[cursor + 1] === "\n" ? 2 : 1;
          continue;
        }
        return cursor;
      }
      cursor += 1;
    }
    return cursor;
  }

  private skipValueTrivia(): void {
    while (this.index < this.source.length) {
      if (
        isHorizontalWhitespace(this.source[this.index]) ||
        isNewline(this.source[this.index])
      ) {
        this.index += 1;
        continue;
      }
      if (
        this.source[this.index] === "/" &&
        this.source[this.index + 1] === "/"
      ) {
        this.index = skipLineComment(this.source, this.index);
        continue;
      }
      if (
        this.source[this.index] === "/" &&
        this.source[this.index + 1] === "*"
      ) {
        this.index = skipBlockComment(this.source, this.index, this.id);
        continue;
      }
      break;
    }
  }

  private skipSeparators(allowLeadingComma: boolean): SeparatorResult {
    let sawComma = false;
    let sawNewline = false;
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (isHorizontalWhitespace(char)) {
        this.index += 1;
        continue;
      }
      if (isNewline(char)) {
        sawNewline = true;
        if (char === "\r" && this.source[this.index + 1] === "\n") {
          this.index += 2;
        } else {
          this.index += 1;
        }
        continue;
      }
      if (char === ",") {
        if (!allowLeadingComma && sawComma) {
          throw this.error("Unexpected repeated object comma", this.index);
        }
        sawComma = true;
        this.index += 1;
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "/") {
        this.index = skipLineComment(this.source, this.index);
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "*") {
        const commentStart = this.index;
        this.index = skipBlockComment(this.source, this.index, this.id);
        for (let cursor = commentStart; cursor < this.index; cursor += 1) {
          if (isNewline(this.source[cursor])) {
            sawNewline = true;
            break;
          }
        }
        continue;
      }
      break;
    }
    return { sawComma, sawNewline };
  }

  private expect(char: string, message: string): void {
    if (this.source[this.index] !== char) {
      throw this.error(message, this.index);
    }
  }

  private error(message: string, index: number): InkSyntaxError {
    return new InkSyntaxError(message, this.source, this.id, index);
  }
}

function skipInlineTriviaAt(
  source: string,
  start: number,
  limit: number,
  id: string,
): number {
  let cursor = start;
  while (cursor < limit) {
    if (isHorizontalWhitespace(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor, id);
      continue;
    }
    break;
  }
  return cursor;
}

function shouldPreserveJavaScriptConst(value: InkValueNode): boolean {
  if (value.kind !== "css-literal") return false;
  const source = value.value.trimStart();
  if (
    source.startsWith("function ") ||
    source.startsWith("function(") ||
    source.startsWith("async function ") ||
    source.startsWith("class ") ||
    source.startsWith("new ")
  ) {
    return true;
  }
  for (let index = 0; index + 1 < source.length; index += 1) {
    if (source[index] === "=" && source[index + 1] === ">") return true;
  }
  return false;
}

function tryParseCssConst(
  source: string,
  constStart: number,
  limit: number,
  id: string,
): InkConstDeclarationNode | null {
  const constToken = readIdentifier(source, constStart);
  let cursor = skipInlineTriviaAt(source, constToken.end, limit, id);
  if (!isIdentifierStart(source[cursor])) return null;
  const nameToken = readIdentifier(source, cursor);
  cursor = skipInlineTriviaAt(source, nameToken.end, limit, id);
  if (source[cursor] !== "=") return null;
  cursor = skipInlineTriviaAt(source, cursor + 1, limit, id);
  if (cursor >= limit || isNewline(source[cursor])) return null;

  const parser = new InkParser(source, id, cursor);
  const value = parser.parseModuleValue();
  if (shouldPreserveJavaScriptConst(value)) return null;
  cursor = skipInlineTriviaAt(source, parser.position, limit, id);
  if (source[cursor] === ";") cursor += 1;
  const next = source[cursor];
  if (
    cursor < limit &&
    !isNewline(next) &&
    !(next === "/" &&
      (source[cursor + 1] === "/" || source[cursor + 1] === "*"))
  ) {
    return null;
  }

  return {
    kind: "const-declaration",
    name: nameToken.value,
    value,
    span: { start: constStart, end: cursor },
  };
}

function parseModulePreamble(
  source: string,
  end: number,
  id: string,
): InkModulePreambleNode[] {
  const nodes: InkModulePreambleNode[] = [];
  let cursor = 0;
  let rawStart = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < end) {
    const char = source[cursor];
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor, id);
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      cursor = skipQuotedSource(source, cursor, id);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      cursor += 1;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      cursor += 1;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      cursor += 1;
      continue;
    }
    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      isIdentifierStart(char)
    ) {
      const token = readIdentifier(source, cursor);
      if (token.value === "const") {
        const declaration = tryParseCssConst(source, cursor, end, id);
        if (declaration) {
          if (rawStart < cursor) {
            nodes.push({
              kind: "raw-module",
              source: source.slice(rawStart, cursor),
              span: { start: rawStart, end: cursor },
            });
          }
          nodes.push(declaration);
          cursor = declaration.span.end;
          rawStart = cursor;
          continue;
        }
      }
      cursor = token.end;
      continue;
    }
    cursor += 1;
  }

  if (rawStart < end) {
    nodes.push({
      kind: "raw-module",
      source: source.slice(rawStart, end),
      span: { start: rawStart, end },
    });
  }
  return nodes;
}

function isJavaScriptIdentifier(value: string): boolean {
  if (!isIdentifierStart(value[0])) return false;
  for (let index = 1; index < value.length; index += 1) {
    if (!isIdentifierPart(value[index])) return false;
  }
  return true;
}

function emitKey(key: InkKeyNode): string {
  return isJavaScriptIdentifier(key.value)
    ? key.value
    : JSON.stringify(key.value);
}

function escapeTemplateCssText(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" || char === "`") {
      escaped += `\\${char}`;
      continue;
    }
    if (char === "$" && value[index + 1] === "{") {
      escaped += "\\${";
      index += 1;
      continue;
    }
    escaped += char;
  }
  return escaped;
}

function emitInterpolatedCss(value: InkInterpolatedCssNode): string {
  let output = "`";
  for (const part of value.parts) {
    output += part.kind === "css-text"
      ? escapeTemplateCssText(part.value)
      : `\${${part.source}}`;
  }
  return `${output}\``;
}

function emitValue(value: InkValueNode, indentation: number): string {
  switch (value.kind) {
    case "object":
      return emitObject(value, indentation);
    case "array":
      return `[${
        value.elements.map((entry) => emitValue(entry, indentation)).join(", ")
      }]`;
    case "css-literal":
    case "string":
      return JSON.stringify(value.value);
    case "template":
      return value.source;
    case "number":
      return value.raw;
    case "boolean":
      return String(value.value);
    case "expression":
      return value.source;
    case "new-expression":
      return `new ${value.callee}(${emitObject(value.argument, indentation)})`;
    case "interpolated-css":
      return emitInterpolatedCss(value);
  }
}

function emitObject(object: InkObjectNode, indentation: number): string {
  if (object.entries.length === 0) return "{}";
  const currentIndent = " ".repeat(indentation);
  const childIndent = " ".repeat(indentation + 2);
  const entries = object.entries.map((entry) =>
    `${childIndent}${emitKey(entry.key)}: ${
      emitValue(entry.value, indentation + 2)
    },`
  );
  return `{\n${entries.join("\n")}\n${currentIndent}}`;
}

function emitModulePreamble(nodes: readonly InkModulePreambleNode[]): string {
  let output = "";
  for (const node of nodes) {
    output += node.kind === "raw-module"
      ? node.source
      : `const ${node.name} = ${emitValue(node.value, 0)};`;
  }
  return output;
}

function consumeDefaultExportSuffix(
  source: string,
  objectEnd: number,
  id: string,
): number {
  let cursor = skipTriviaAt(source, objectEnd, id);
  if (isIdentifierStart(source[cursor])) {
    const asToken = readIdentifier(source, cursor);
    if (asToken.value === "as") {
      const constStart = skipTriviaAt(source, asToken.end, id);
      if (isIdentifierStart(source[constStart])) {
        const constToken = readIdentifier(source, constStart);
        if (constToken.value === "const") {
          cursor = skipTriviaAt(source, constToken.end, id);
        }
      }
    }
  }
  if (source[cursor] === ";") cursor += 1;
  return cursor;
}

function emitModule(module: InkModuleNode): string {
  let code = emitModulePreamble(module.preamble);
  if (code.length > 0 && !isNewline(code[code.length - 1])) {
    code += "\n";
  }
  code += `export default ${emitObject(module.defaultExport, 0)};`;
  if (module.suffix.length > 0) {
    if (!isNewline(module.suffix[0])) code += "\n";
    code += module.suffix;
  } else {
    code += "\n";
  }
  return code;
}

/**
 * Compile a data-oriented `.ink` module to ordinary ESM.
 *
 * The source is parsed into a dedicated syntax tree. Newlines separate object
 * entries, arrays remain comma-delimited, raw values become CSS strings,
 * top-level constants accept CSS values, and `=expression` preserves or
 * interpolates an explicit JavaScript expression.
 */
export function compileInkModule(
  source: string,
  id = "<ink-module>",
): CompileInkModuleResult {
  const location = findDefaultExport(source, id);
  const preamble = parseModulePreamble(source, location.exportStart, id);
  const parser = new InkParser(source, id, location.objectStart);
  const defaultExport = parser.parseObject();
  const suffixStart = consumeDefaultExportSuffix(source, parser.position, id);
  const ast: InkModuleNode = {
    kind: "module",
    prefix: source.slice(0, location.exportStart),
    preamble,
    defaultExport,
    suffix: source.slice(suffixStart),
    span: { start: 0, end: source.length },
  };
  return {
    code: emitModule(ast),
    ast,
    map: null,
  };
}
