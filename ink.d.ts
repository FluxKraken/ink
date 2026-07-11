declare module "*.ink" {
  const styles: import("./dist/shared.d.ts").StyleSheet;
  export default styles;
}
