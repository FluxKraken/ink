/** Class names emitted for each statically extracted style key. */
export type StaticClassMap = Record<string, string>;

/**
 * Class names emitted for each `variant.<group>.<value>.<styleKey>` entry.
 */
export type StaticVariantClassMap = Record<
  string,
  Record<string, StaticClassMap>
>;

/**
 * A declaration map keyed by its original CSS property name. Each value is an
 * already serialized `property:value` pair without a trailing semicolon.
 *
 * Keeping the property as the key lets the generated accessor reproduce Ink's
 * left-to-right inline-style override behavior without retaining style values,
 * the serializer, or runtime configuration.
 */
export type StaticInlineDeclarationMap = Record<string, string>;

/** Inline declarations emitted for each statically extracted style key. */
export type StaticInlineBaseMap = Record<
  string,
  StaticInlineDeclarationMap
>;

/**
 * Inline declarations emitted for each
 * `variant.<group>.<value>.<styleKey>` entry.
 */
export type StaticInlineVariantMap = Record<
  string,
  Record<string, StaticInlineBaseMap>
>;

/**
 * Marks variant style entries whose class composition must pass through
 * `tailwind-merge`. Unmarked entries use ordinary space-separated joining.
 */
export type StaticTailwindMergeVariantMap = Record<
  string,
  Record<string, Record<string, boolean>>
>;

/** Data needed by the small accessor runtime emitted for static resolution. */
export interface StaticAccessorModel {
  /** Return the single style accessor itself instead of an accessor factory. */
  simple?: boolean;
  /** Statically extracted base class names, keyed by style key. */
  base?: StaticClassMap;
  /** Statically extracted variant class names. */
  variant?: StaticVariantClassMap;
  /** Default variant values. Boolean values are resolved as `"true"`/`"false"`. */
  defaults?: Record<string, string | boolean>;
  /** CSS-module class names. Keys absent from `base` become module-only accessors. */
  modules?: StaticClassMap;
  /** Pre-serialized base declarations used only by `.style()`. */
  inlineBase?: StaticInlineBaseMap;
  /** Pre-serialized variant declarations used only by `.style()`. */
  inlineVariant?: StaticInlineVariantMap;
  /** Variant style entries that require Tailwind-aware class merging. */
  tailwindMergeVariant?: StaticTailwindMergeVariantMap;
}

export interface StaticAccessorCodegenOptions {
  /**
   * JavaScript identifier for an in-scope Tailwind merge function. It is only
   * referenced when at least one `tailwindMergeVariant` flag is true.
   */
  mergeFunctionIdentifier?: string;
}

/** Internal key used by Ink's single-slot (`simple: true`) representation. */
export const STATIC_SIMPLE_STYLE_KEY = "__ink_simple__";

const JAVASCRIPT_IDENTIFIER = /^[$A-Z_a-z][$\w]*$/;

function hasEnabledTailwindMergeFlag(
  flags: StaticTailwindMergeVariantMap | undefined,
): boolean {
  if (!flags) {
    return false;
  }

  for (const variants of Object.values(flags)) {
    for (const styles of Object.values(variants)) {
      if (Object.values(styles).some((enabled) => enabled === true)) {
        return true;
      }
    }
  }

  return false;
}

function hasEntries(value: object | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0;
}

function getOwnValue<T>(
  value: Record<string, T> | undefined,
  key: string,
): T | undefined {
  return value !== undefined &&
      Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : undefined;
}

type VariantFreeAccessorEntry = {
  className: string;
  inlineStyle: string;
};

function toVariantFreeAccessorEntry(
  model: StaticAccessorModel,
  key: string,
): VariantFreeAccessorEntry | undefined {
  const baseClassName = getOwnValue(model.base, key);
  const moduleClassName = getOwnValue(model.modules, key);
  const className = baseClassName ?? moduleClassName;
  if (className === undefined) {
    return undefined;
  }

  const inlineDeclarations = baseClassName === undefined
    ? undefined
    : getOwnValue(model.inlineBase, key);
  return {
    className,
    inlineStyle: Object.values(inlineDeclarations ?? {}).join(";"),
  };
}

function toVariantFreeAccessorMapLiteral(
  entries: ReadonlyMap<string, VariantFreeAccessorEntry>,
): string {
  const fields = Array.from(
    entries,
    ([key, entry]) =>
      `[${JSON.stringify(key)}]:A(${JSON.stringify(entry.className)},${
        JSON.stringify(entry.inlineStyle)
      })`,
  );
  return `{${fields.join(",")}}`;
}

function toSingleAccessorExpression(entry: VariantFreeAccessorEntry): string {
  return `(()=>{const a=()=>${
    JSON.stringify(entry.className)
  };a.class=a;a.style=()=>${JSON.stringify(entry.inlineStyle)};return a})()`;
}

/** Emit a much smaller accessor when no runtime variant selection is needed. */
function generateVariantFreeAccessorExpression(
  model: StaticAccessorModel,
): string {
  const emptyEntry: VariantFreeAccessorEntry = {
    className: "",
    inlineStyle: "",
  };

  if (model.simple === true) {
    const moduleKeys = Object.keys(model.modules ?? {}).filter((key) =>
      key !== STATIC_SIMPLE_STYLE_KEY
    );
    const simpleEntry = toVariantFreeAccessorEntry(
      model,
      STATIC_SIMPLE_STYLE_KEY,
    ) ?? emptyEntry;

    if (moduleKeys.length === 0) {
      return toSingleAccessorExpression(simpleEntry);
    }

    const entries = new Map<string, VariantFreeAccessorEntry>();
    entries.set(STATIC_SIMPLE_STYLE_KEY, simpleEntry);
    for (const key of moduleKeys) {
      const entry = toVariantFreeAccessorEntry(model, key);
      if (entry) {
        entries.set(key, entry);
      }
    }

    const accessors = toVariantFreeAccessorMapLiteral(entries);
    const simpleStyleKey = JSON.stringify(STATIC_SIMPLE_STYLE_KEY);
    const exposedKeys = JSON.stringify(moduleKeys);
    return `(()=>{const A=(c,s)=>{const f=()=>c;f.class=f;f.style=()=>s;return f},x=${accessors},a=x[${simpleStyleKey}];for(const k of ${exposedKeys})if(!(k in a))Object.defineProperty(a,k,{get:()=>x[k],enumerable:true,configurable:true});return a})()`;
  }

  const entries = new Map<string, VariantFreeAccessorEntry>();
  for (const key of Object.keys(model.base ?? {})) {
    const entry = toVariantFreeAccessorEntry(model, key);
    if (entry) {
      entries.set(key, entry);
    }
  }
  for (const key of Object.keys(model.modules ?? {})) {
    if (entries.has(key)) {
      continue;
    }
    const entry = toVariantFreeAccessorEntry(model, key);
    if (entry) {
      entries.set(key, entry);
    }
  }

  const accessors = entries.size > 0
    ? `const A=(c,s)=>{const f=()=>c;f.class=f;f.style=()=>s;return f},a=${
      toVariantFreeAccessorMapLiteral(entries)
    }`
    : "const a={}";
  return `(()=>{${accessors},f=()=>a;return new Proxy(f,{get:(t,p,r)=>p in a?a[p]:Reflect.get(t,p,r),has:(t,p)=>p in a||Reflect.has(t,p),ownKeys:t=>[...new Set([...Reflect.ownKeys(t),...Object.keys(a)])],getOwnPropertyDescriptor:(t,p)=>p in a?{enumerable:true,configurable:true,writable:true}:Reflect.getOwnPropertyDescriptor(t,p)})})()`;
}

/**
 * Serialize JSON-shaped compiler data as a JavaScript literal.
 *
 * Object keys are emitted as computed string keys so `__proto__` remains an
 * ordinary own property instead of taking on object-literal prototype syntax.
 */
function toLiteral(value: unknown): string {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(toLiteral).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) =>
      `[${JSON.stringify(key)}]:${toLiteral(entry)}`
    );
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(
    "Static accessor data must contain only JSON-safe values.",
  );
}

/**
 * Generate a self-contained JavaScript expression for a statically extracted
 * Ink accessor.
 *
 * The expression deliberately contains no Ink import or original declaration
 * objects. The only permitted external reference is `mergeFunctionIdentifier`,
 * and only models with a true Tailwind merge flag require it.
 */
export function generateStaticAccessorExpression(
  model: StaticAccessorModel,
  options: StaticAccessorCodegenOptions = {},
): string {
  const mergeFunctionIdentifier = options.mergeFunctionIdentifier;
  if (
    mergeFunctionIdentifier !== undefined &&
    !JAVASCRIPT_IDENTIFIER.test(mergeFunctionIdentifier)
  ) {
    throw new TypeError(
      `Invalid Tailwind merge function identifier: ${mergeFunctionIdentifier}`,
    );
  }

  if (
    !hasEntries(model.variant) && !hasEntries(model.defaults) &&
    !hasEntries(model.inlineVariant) &&
    !hasEntries(model.tailwindMergeVariant)
  ) {
    return generateVariantFreeAccessorExpression(model);
  }

  const needsTailwindMerge = hasEnabledTailwindMergeFlag(
    model.tailwindMergeVariant,
  );

  if (needsTailwindMerge && !mergeFunctionIdentifier) {
    throw new TypeError(
      "Static accessor code generation requires a Tailwind merge function identifier when a variant merge flag is enabled.",
    );
  }

  const base = toLiteral(model.base ?? {});
  const variant = toLiteral(model.variant ?? {});
  const defaults = toLiteral(model.defaults ?? {});
  const modules = toLiteral(model.modules ?? {});
  const inlineBase = toLiteral(model.inlineBase ?? {});
  const inlineVariant = toLiteral(model.inlineVariant ?? {});
  const tailwindMergeVariant = toLiteral(model.tailwindMergeVariant ?? {});
  const simple = model.simple === true ? "true" : "false";
  const merge = needsTailwindMerge ? mergeFunctionIdentifier! : "undefined";
  const simpleStyleKey = JSON.stringify(STATIC_SIMPLE_STYLE_KEY);

  return `((merge)=>{
const b=${base},v=${variant},d=${defaults},m=${modules},i=${inlineBase},w=${inlineVariant},t=${tailwindMergeVariant},simple=${simple};
const own=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
const get=(o,k)=>own(o,k)?o[k]:undefined;
const selected=s=>s?{...d,...s}:d;
const make=(k,c,baseInline)=>{
  const className=s=>{
    const names=c?[c]:[];
    let shouldMerge=false;
    for(const [group,value] of Object.entries(selected(s))){
      if(value==null)continue;
      const variantName=String(value);
      const variantClass=get(get(get(v,group),variantName),k);
      if(variantClass)names.push(variantClass);
      if(get(get(get(t,group),variantName),k)===true)shouldMerge=true;
    }
    if(names.length<2)return names[0]??"";
    if(!shouldMerge)return names.join(" ");
    const normalized=names.map(value=>value.trim()).filter(Boolean);
    return normalized.length?merge(...normalized):"";
  };
  const accessor=className;
  accessor.class=className;
  accessor.style=s=>{
    const declarations=Object.assign(Object.create(null),baseInline??{});
    for(const [group,value] of Object.entries(selected(s))){
      if(value==null)continue;
      Object.assign(declarations,get(get(get(w,group),String(value)),k)??{});
    }
    return Object.values(declarations).join(";");
  };
  return accessor;
};
const constant=c=>{
  const accessor=()=>c;
  accessor.class=accessor;
  accessor.style=()=>"";
  return accessor;
};
const accessors={};
for(const [key,className] of Object.entries(b))accessors[key]=make(key,className,get(i,key));
for(const [key,className] of Object.entries(m))if(!own(accessors,key))accessors[key]=constant(className);
if(simple){
  const accessor=own(accessors,${simpleStyleKey})?accessors[${simpleStyleKey}]:constant("");
  for(const key of Object.keys(m))if(key!==${simpleStyleKey}&&!(key in accessor))Object.defineProperty(accessor,key,{get:()=>accessors[key],enumerable:true,configurable:true});
  return accessor;
}
const factory=()=>accessors;
return new Proxy(factory,{
  get:(target,property,receiver)=>typeof property==="string"&&own(accessors,property)?accessors[property]:Reflect.get(target,property,receiver),
  has:(target,property)=>typeof property==="string"&&own(accessors,property)||Reflect.has(target,property),
  ownKeys:target=>Array.from(new Set([...Reflect.ownKeys(target),...Object.keys(accessors)])),
  getOwnPropertyDescriptor:(target,property)=>typeof property==="string"&&own(accessors,property)?{enumerable:true,configurable:true,writable:true}:Reflect.getOwnPropertyDescriptor(target,property)
});
})(${merge})`;
}
