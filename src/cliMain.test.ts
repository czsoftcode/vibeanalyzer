import { describe, expect, it, vi } from "vitest";
import type { RunDeps } from "./cli.js";
import { type CliMainDeps, runCli } from "./cliMain.js";
import type { ReadlineAsk } from "./readlineAsk.js";

/**
 * Fake readline rozhraní: zaznamenává počet zavření a vydá triviální `ask`.
 * Slouží k ověření, že `close()` padne právě jednou a `ask` se předá do `run`.
 */
function fakeReadline(): { rl: ReadlineAsk; closeCount: () => number } {
  let closes = 0;
  const rl: ReadlineAsk = {
    ask: async () => null,
    close: () => {
      closes += 1;
    },
  };
  return { rl, closeCount: () => closes };
}

/** Poskládá CliMainDeps s rozumnými defaulty; jednotlivý test si přepíše, co potřebuje. */
function makeDeps(overrides: Partial<CliMainDeps> = {}): CliMainDeps {
  return {
    argv: [],
    cwd: "/x",
    isInteractive: false,
    createAsk: () => fakeReadline().rl,
    run: async () => 0,
    ...overrides,
  };
}

describe("runCli – orchestrace vstupního bodu (10-1)", () => {
  it("interaktivně: ask se předá do run, close padne právě jednou", async () => {
    const { rl, closeCount } = fakeReadline();
    let seen: RunDeps | undefined;
    const code = await runCli(
      makeDeps({
        isInteractive: true,
        createAsk: () => rl,
        run: async (_argv, _cwd, deps) => {
          seen = deps;
          return 0;
        },
      }),
    );
    expect(code).toBe(0);
    expect(seen?.ask).toBe(rl.ask); // dotazovač předán
    expect(seen?.isInteractive).toBe(true);
    expect(closeCount()).toBe(1); // zavřeno právě jednou
  });

  it("close() padne i když run() vyhodí výjimku (proces se nezasekne)", async () => {
    const { rl, closeCount } = fakeReadline();
    const onUnexpected = vi.fn();
    const code = await runCli(
      makeDeps({
        isInteractive: true,
        createAsk: () => rl,
        run: async () => {
          throw new Error("rozbité run");
        },
        onUnexpected,
      }),
    );
    expect(code).toBe(1); // nečekaná chyba → exit 1, žádný tichý exit 0
    expect(onUnexpected).toHaveBeenCalledOnce();
    expect(closeCount()).toBe(1); // close i v chybové větvi (finally)
  });

  it("pád createAsk() → exit 1 + log (ne unhandled rejection, ne tichý exit 0)", async () => {
    // Továrna na rozhraní vyhodí (např. readline odmítne stream). runCli musí být
    // totální: chytit to, zalogovat a vrátit 1 – ne nechat reject utéct do Node.
    const onUnexpected = vi.fn();
    let runCalled = false;
    const code = await runCli(
      makeDeps({
        isInteractive: true,
        createAsk: () => {
          throw new Error("rozbitá továrna na rozhraní");
        },
        run: async () => {
          runCalled = true;
          return 0;
        },
        onUnexpected,
      }),
    );
    expect(code).toBe(1); // ne tichý exit 0
    expect(onUnexpected).toHaveBeenCalledOnce();
    expect(runCalled).toBe(false); // run() se ani nespustil
  });

  it("ne-interaktivně: createAsk se NEvolá, ask je undefined, rozhraní nevznikne", async () => {
    const createAsk = vi.fn(() => fakeReadline().rl);
    let seen: RunDeps | undefined;
    const code = await runCli(
      makeDeps({
        isInteractive: false,
        createAsk,
        run: async (_argv, _cwd, deps) => {
          seen = deps;
          return 3;
        },
      }),
    );
    expect(code).toBe(3); // exit kód z run prochází beze změny
    expect(createAsk).not.toHaveBeenCalled(); // žádné rozhraní (žádný sáhnutý stdin)
    expect(seen?.ask).toBeUndefined();
    expect(seen?.isInteractive).toBe(false);
  });

  it("ne-interaktivní pád run() → exit 1, nic se nezavírá (rozhraní nevzniklo)", async () => {
    const createAsk = vi.fn(() => fakeReadline().rl);
    const onUnexpected = vi.fn();
    const code = await runCli(
      makeDeps({
        isInteractive: false,
        createAsk,
        run: async () => {
          throw new Error("pád bez rozhraní");
        },
        onUnexpected,
      }),
    );
    expect(code).toBe(1);
    expect(onUnexpected).toHaveBeenCalledOnce();
    expect(createAsk).not.toHaveBeenCalled(); // nebylo co zavírat
  });

  it("argv/cwd se předají do run beze změny", async () => {
    let seenArgv: readonly string[] | undefined;
    let seenCwd: string | undefined;
    await runCli(
      makeDeps({
        argv: ["--help"],
        cwd: "/projekt",
        run: async (argv, cwd) => {
          seenArgv = argv;
          seenCwd = cwd;
          return 0;
        },
      }),
    );
    expect(seenArgv).toEqual(["--help"]);
    expect(seenCwd).toBe("/projekt");
  });
});
