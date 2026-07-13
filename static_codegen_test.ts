import { assert, assertEquals } from "jsr:@std/assert";
import {
  generateStaticAccessorExpression,
  STATIC_SIMPLE_STYLE_KEY,
} from "./src/static-codegen.ts";

type Selection = Record<string, string | boolean>;

interface TestAccessor {
  (selection?: Selection): string;
  class(selection?: Selection): string;
  style(selection?: Selection): string;
  [key: string]: unknown;
}

interface TestFactory {
  (): Record<string, TestAccessor>;
  [key: string]: unknown;
}

function evaluateExpression(
  expression: string,
  bindings: Record<string, unknown> = {},
): unknown {
  const names = Object.keys(bindings);
  return Function(...names, `"use strict";return (${expression});`)(
    ...names.map((name) => bindings[name]),
  );
}

function asAccessor(value: unknown): TestAccessor {
  return value as TestAccessor;
}

Deno.test("static codegen emits a small variant-free accessor factory", () => {
  const expression = generateStaticAccessorExpression({
    base: { main: "ink_main", name: "ink_name" },
    modules: { icon: "module_icon" },
    inlineBase: {
      main: { color: "color:red", padding: "padding:1rem" },
    },
  });
  const styles = evaluateExpression(expression) as TestFactory;

  assert(expression.length < 500, `generated ${expression.length} bytes`);
  assertEquals(asAccessor(styles.main)(), "ink_main");
  assertEquals(asAccessor(styles.main).class(), "ink_main");
  assertEquals(asAccessor(styles.main).style(), "color:red;padding:1rem");
  assertEquals(styles().main(), "ink_main");
  assertEquals(asAccessor(styles.name)(), "ink_name");
  assertEquals(asAccessor(styles.icon)(), "module_icon");
  assertEquals(asAccessor(styles.icon).style(), "");
  assertEquals(Object.keys(styles), ["name", "main", "icon"]);
});

Deno.test("static codegen preserves simple accessors and module properties", () => {
  const expression = generateStaticAccessorExpression({
    simple: true,
    base: {
      [STATIC_SIMPLE_STYLE_KEY]: "ink_content",
      icon: "ink_icon",
    },
    modules: { icon: "module_icon", badge: "module_badge" },
    inlineBase: {
      [STATIC_SIMPLE_STYLE_KEY]: { display: "display:block" },
      icon: { color: "color:blue" },
    },
  });
  const content = evaluateExpression(expression) as TestAccessor;

  assertEquals(content(), "ink_content");
  assertEquals(content.class(), "ink_content");
  assertEquals(content.style(), "display:block");
  assertEquals(asAccessor(content.icon)(), "ink_icon");
  assertEquals(asAccessor(content.icon).style(), "color:blue");
  assertEquals(asAccessor(content.badge)(), "module_badge");
  assertEquals(asAccessor(content.badge).style(), "");
});

Deno.test("static codegen resolves defaults, booleans, and Tailwind variants", () => {
  const expression = generateStaticAccessorExpression({
    base: { button: "base px-2" },
    variant: {
      tone: {
        primary: { button: "px-4 primary" },
        secondary: { button: "secondary" },
      },
      active: {
        false: { button: "inactive" },
        true: { button: "active" },
      },
    },
    defaults: { tone: "primary", active: false },
    inlineBase: {
      button: { color: "color:red", padding: "padding:1rem" },
    },
    inlineVariant: {
      tone: {
        primary: { button: { color: "color:blue" } },
        secondary: { button: { color: "color:green" } },
      },
      active: {
        false: { button: { padding: "padding:0" } },
        true: { button: { padding: "padding:2rem" } },
      },
    },
    tailwindMergeVariant: {
      tone: { primary: { button: true } },
    },
  }, { mergeFunctionIdentifier: "mergeClasses" });
  const mergeCalls: string[][] = [];
  const styles = evaluateExpression(expression, {
    mergeClasses: (...values: string[]) => {
      mergeCalls.push(values);
      return values.join("|");
    },
  }) as TestFactory;
  const accessorMap = styles();
  const button = asAccessor(styles.button);

  assertEquals(Object.getPrototypeOf(accessorMap), Object.prototype);
  assert(Object.prototype.hasOwnProperty.call(accessorMap, "button"));
  assertEquals(button(), "base px-2|px-4 primary|inactive");
  assertEquals(mergeCalls, [["base px-2", "px-4 primary", "inactive"]]);
  assertEquals(button.style(), "color:blue;padding:0");
  assertEquals(
    button({ tone: "secondary", active: true }),
    "base px-2 secondary active",
  );
  assertEquals(
    button.style({ tone: "secondary", active: true }),
    "color:green;padding:2rem",
  );
});
