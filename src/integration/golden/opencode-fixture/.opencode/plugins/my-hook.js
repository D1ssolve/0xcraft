// Opaque OpenCode plugin hook - imported as runtime_code
export default function myHookPlugin(hooks) {
  hooks["tool.execute.before"] = async (ctx) => {
    console.log("[my-hook] before tool execute:", ctx.tool.name);
  };

  hooks["tool.execute.after"] = async (ctx) => {
    console.log("[my-hook] after tool execute:", ctx.tool.name);
  };
}
