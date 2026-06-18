import { fork } from "node:child_process";

/**
 * Spuštění strojové vrstvy v IZOLOVANÉM podprocesu (fork). Smysl: tsc/ESLint nad
 * obřím projektem můžou spotřebovat paměť (OOM) nebo se zaseknout; v našem procesu
 * by to shodilo celý nástroj a žádný report by nevznikl. Ve forku spadne/zabije se
 * jen dítě a rodič přežije → vrstvu čistě označí za přeskočenou.
 *
 * Fork (samostatný OS proces), ne worker_threads: `--max-old-space-size` limituje
 * jen V8 heap, ne nativní alokace; jako oddělený proces přežije rodič i nativní OOM
 * dítěte (u workeru sdílíme paměť procesu → slabší záruka).
 */

/** Zpráva „začínám" – nese počet souborů pro progress hlášku (tsc i source). */
export interface StartedMessage {
  type: "started";
  fileCount: number;
  source?: "project" | "bundled";
}
/** Zpráva s hotovým výsledkem analýzy (diskriminovaný union TscResult/EslintResult). */
export interface ResultMessage<T> {
  type: "result";
  payload: T;
}
export type ChildMessage<T> = StartedMessage | ResultMessage<T>;

/**
 * Výsledek izolovaného běhu. `ok` = dítě vrátilo výsledek. Ostatní = dítě neuspělo
 * a rodič MUSÍ rozlišit DŮVOD (ať skip reason nelže):
 *  - `oom`     dítě umřelo na nedostatku paměti (příliš velký projekt)
 *  - `timeout` rodič dítě zabil po vypršení času (zaseknutí / příliš dlouhý běh)
 *  - `crashed` dítě spadlo z jiného důvodu (bug v našem kódu) – `detail` = stderr
 */
export type IsolatedOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "oom" }
  | { kind: "timeout" }
  | { kind: "crashed"; detail: string };

export interface RunIsolatedOptions {
  /** Cesta ke spustitelnému child skriptu (prod: dist/*.js; test: fixtura). */
  childPath: string;
  /** Extra argumenty pro Node v dítěti (sem patří `--max-old-space-size=…`, případně loader). */
  execArgv?: readonly string[];
  /** Zadání pro dítě (musí být serializovatelné přes IPC – žádné funkce). */
  payload: unknown;
  /** Po této době rodič dítě zabije a vrátí `timeout`. */
  timeoutMs: number;
  /** Volá se při zprávě „started" z dítěte (kvůli progress hlášce). */
  onStarted?: (m: StartedMessage) => void;
}

// Signatura OOM ve stderru Node/V8. Spolehlivější napříč OS než exit kód:
// V8 při vyčerpání heapu vypíše „FATAL ERROR: … JavaScript heap out of memory"
// a abortuje (na Linuxu SIGABRT / kód 134), ale kód/signál se mezi platformami liší.
const OOM_STDERR_RE = /heap out of memory|Allocation failed|out of memory|FATAL ERROR/i;

function looksLikeOom(code: number | null, signal: NodeJS.Signals | null, stderr: string): boolean {
  if (OOM_STDERR_RE.test(stderr)) return true;
  if (signal === "SIGABRT") return true;
  if (code === 134) return true; // 128 + SIGABRT
  return false;
}

/**
 * Forkne `childPath`, pošle mu `payload`, počká na výsledek. Nikdy nehází kvůli
 * pádu dítěte – pád/timeout převede na `IsolatedOutcome`. Po jakémkoli konci uklidí
 * (vyčistí timer, zabije přeživší dítě) → žádný zombie proces ani visící timer.
 */
export function runIsolated<T>(opts: RunIsolatedOptions): Promise<IsolatedOutcome<T>> {
  const { childPath, execArgv = [], payload, timeoutMs, onStarted } = opts;

  return new Promise<IsolatedOutcome<T>>((resolve) => {
    const child = fork(childPath, [], {
      // stdin/stdout zahodíme (progress jde přes IPC a tiskne rodič), stderr
      // odchytíme kvůli detekci OOM a přeposlání při pádu; 4. kanál = IPC.
      execArgv: [...execArgv],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    let settled = false;
    let timedOut = false;
    let gotResult = false;
    let stderr = "";

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL"); // SIGKILL: zaseknuté dítě v tight-loopu SIGTERM ignoruje
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      // pojistka proti zombie: kdyby dítě po settle ještě žilo, dorazíme ho
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const settle = (outcome: IsolatedOutcome<T>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("message", (msg: ChildMessage<T>) => {
      if (msg && msg.type === "started") {
        onStarted?.(msg);
      } else if (msg && msg.type === "result") {
        gotResult = true;
        settle({ kind: "ok", value: msg.payload });
      }
    });

    // fork sám selhal (např. nejde spustit) – ber jako pád, ne jako OOM.
    child.on("error", (err) => {
      settle({ kind: "crashed", detail: err.stack ?? err.message });
    });

    child.on("exit", (code, signal) => {
      if (gotResult) return; // výsledek už dorazil zprávou, exit je jen dokončení
      if (timedOut) {
        settle({ kind: "timeout" });
      } else if (looksLikeOom(code, signal, stderr)) {
        settle({ kind: "oom" });
      } else {
        const why = signal ? `signál ${signal}` : `kód ${code}`;
        settle({ kind: "crashed", detail: `${why}\n${stderr}`.trim() });
      }
    });

    child.send(payload as Parameters<typeof child.send>[0], (err) => {
      // poslání zadání selhalo (kanál zavřený) – dítě stejně nic neudělá
      if (err) settle({ kind: "crashed", detail: `nepodařilo se předat zadání dítěti: ${err.message}` });
    });
  });
}
