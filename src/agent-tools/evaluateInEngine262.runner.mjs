/**
 * Child process runner script for engine262 evaluation.
 * Reads code from stdin, executes in engine262, outputs JSON to stdout.
 */

// Read code from stdin
let code = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  code += chunk;
});
process.stdin.on("end", async () => {
  try {
    // Load engine262
    console.error("[RUNNER] Loading engine262...");
    const engine = await import("../../engine262/lib/engine262.mjs");
    console.error("[RUNNER] Engine loaded successfully");

    const Agent = engine.Agent;
    const ManagedRealm = engine.ManagedRealm;
    const setSurroundingAgent = engine.setSurroundingAgent;
    const OrdinaryObjectCreate = engine.OrdinaryObjectCreate;
    const CreateBuiltinFunction = engine.CreateBuiltinFunction;
    const CreateDataProperty = engine.CreateDataProperty;
    const Value = engine.Value;
    const skipDebugger = engine.skipDebugger;
    const ask262Debug = engine.ask262Debug;

    // Reset state
    ask262Debug.reset();

    // Array to capture console output
    const consoleOutput = [];

    // Set up agent and realm
    console.error("[RUNNER] Creating agent and realm");
    const agent = new Agent();
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    console.error("[RUNNER] Realm created");

    // Expose ask262Debug and console to the evaluated code
    realm.scope(() => {
      const debugObj = OrdinaryObjectCreate(
        agent.intrinsic("%Object.prototype%"),
      );
      skipDebugger(
        CreateDataProperty(realm.GlobalObject, Value("ask262Debug"), debugObj),
      );

      const startImportant = CreateBuiltinFunction(
        () => {
          ask262Debug.startImportant();
          return Value("undefined");
        },
        0,
        Value("startImportant"),
        [],
      );
      skipDebugger(
        CreateDataProperty(debugObj, Value("startImportant"), startImportant),
      );

      const stopImportant = CreateBuiltinFunction(
        () => {
          ask262Debug.stopImportant();
          return Value("undefined");
        },
        0,
        Value("stopImportant"),
        [],
      );
      skipDebugger(
        CreateDataProperty(debugObj, Value("stopImportant"), stopImportant),
      );

      // Create console object
      const consoleObj = OrdinaryObjectCreate(
        agent.intrinsic("%Object.prototype%"),
      );
      skipDebugger(
        CreateDataProperty(realm.GlobalObject, Value("console"), consoleObj),
      );

      // Add console methods: log, warn, debug, error
      const consoleMethods = ["log", "warn", "debug", "error"];
      for (const method of consoleMethods) {
        const fn = CreateBuiltinFunction(
          (args) => {
            const jsValues = args.map((arg) => {
              if (arg && typeof arg === "object") {
                const strVal = arg.stringValue;
                if (typeof strVal === "function") {
                  return strVal.call(arg);
                }
                const value = arg.value;
                if (value !== undefined) {
                  return value;
                }
              }
              return arg;
            });
            consoleOutput.push({ method, values: jsValues });
            return Value("undefined");
          },
          1,
          Value(method),
          [],
        );
        skipDebugger(CreateDataProperty(consoleObj, Value(method), fn));
      }
    });

    // Start tracing
    console.error("[RUNNER] Starting trace");
    ask262Debug.startTrace();

    // Execute the code
    console.error("[RUNNER] Executing code...");
    const completion = realm.evaluateScript(code);
    console.error("[RUNNER] Code execution complete");

    // Stop tracing
    ask262Debug.stopTrace();

    // Check for error completion
    if (completion?.Type === "throw") {
      const errorValue = completion.Value;
      const errorMessage =
        errorValue?.ErrorData?.stringValue?.() ||
        errorValue?.ErrorData?.value ||
        "Unknown error";
      console.error(`[RUNNER] Script threw error: ${errorMessage}`);
      console.log(JSON.stringify({ error: errorMessage }));
      process.exit(0);
    }

    // Get captured marks
    const marks = ask262Debug.marks;
    console.error(`[RUNNER] Captured ${marks.length} marks`);

    // Filter and group marks by important flag
    const importantMarks = marks.filter((m) => m.important);
    const otherMarks = marks.filter((m) => !m.important);

    // Output result as JSON
    const result = {
      importantSections: importantMarks.flatMap((m) => m.sectionIds),
      otherSections: otherMarks.flatMap((m) => m.sectionIds),
      consoleOutput: consoleOutput,
    };

    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[RUNNER] Fatal error: ${errorMsg}`);
    process.exit(1);
  }
});
