import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { detectSecrets } from "./secrets.js";

/**
 * Falešná, syntakticky platná, ale NEAKTIVNÍ tajemství k testům. Nejde o reálné
 * klíče – jen tvarem odpovídají vzorům, ať detektor má co chytit.
 */
const SAMPLES = {
  awsKeyId: "AKIAIOSFODNN7EXAMPLE",
  githubToken: `ghp_${"a1B2c3D4e5".repeat(4)}`, // 4+ délka přes 36
  googleKey: `AIza${"A".repeat(35)}`,
  slackToken: `xoxb-1234567890123-1234567890123-${"a".repeat(24)}`,
  stripeKey: `sk_live_${"0aZ".repeat(9)}`, // 27 znaků těla
  pemLine: "-----BEGIN RSA PRIVATE KEY-----",
  pemOpenssh: "-----BEGIN OPENSSH PRIVATE KEY-----",
};

describe("detectSecrets – každý vzor chytne svou ukázku", () => {
  it("AWS Access Key ID", () => {
    const hits = detectSecrets(`const k = "${SAMPLES.awsKeyId}";`);
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    assert(hit);
    expect(hit.rule).toBe("aws-access-key-id");
    expect(hit.severity).toBe("error");
    expect(hit.line).toBe(1);
  });

  it("GitHub token", () => {
    const hits = detectSecrets(`token=${SAMPLES.githubToken}`);
    expect(hits.map((h) => h.rule)).toContain("github-token");
  });

  it("Google API key", () => {
    const hits = detectSecrets(SAMPLES.googleKey);
    expect(hits.map((h) => h.rule)).toContain("google-api-key");
  });

  it("Slack token", () => {
    const hits = detectSecrets(SAMPLES.slackToken);
    expect(hits.map((h) => h.rule)).toContain("slack-token");
  });

  it("Stripe secret key", () => {
    const hits = detectSecrets(SAMPLES.stripeKey);
    expect(hits.map((h) => h.rule)).toContain("stripe-secret-key");
  });

  it("PEM privátní klíč (RSA i OPENSSH)", () => {
    expect(detectSecrets(SAMPLES.pemLine).map((h) => h.rule)).toContain("private-key");
    expect(detectSecrets(SAMPLES.pemOpenssh).map((h) => h.rule)).toContain("private-key");
  });
});

describe("detectSecrets – zuby na druhou stranu: čistý text NIC nehlásí", () => {
  it("běžné base64 / hash / UUID / git SHA nejsou tajemství", () => {
    const clean = [
      "const hash = '5d41402abc4b2a76b9719d911017c592';", // md5
      "sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "id: 550e8400-e29b-41d4-a716-446655440000", // uuid
      "commit 0be1f3a9c2d4e6f8a0b1c2d3e4f5a6b7c8d9e0f1",
      "const data = 'aGVsbG8gd29ybGQgdGhpcyBpcyBqdXN0IGJhc2U2NA==';",
      "import { thing } from './module';",
    ].join("\n");
    expect(detectSecrets(clean)).toEqual([]);
  });

  it("prázdný vstup", () => {
    expect(detectSecrets("")).toEqual([]);
  });

  it("dokumentační placeholdery NEjsou tajemství (zub na konzervativnost)", () => {
    // Přesně to, čím by trpěl moc volný vzor – tady MUSÍ být ticho.
    const placeholders = [
      "SLACK_TOKEN=xoxb-your-token-here",
      "slack: xoxp-some-placeholder-value",
      "github_token=ghp_xxx",
      "GITHUB_PAT=ghp_REPLACE_ME",
      "STRIPE=sk_live_REPLACE_ME",
      "aws_key=AKIA_PLACEHOLDER",
      "GOOGLE_API_KEY=AIza...your-key...",
    ].join("\n");
    expect(detectSecrets(placeholders)).toEqual([]);
  });
});

describe("detectSecrets – ÚNIK: výstup nikdy nenese celou hodnotu (hlavní zub fáze)", () => {
  it("maskovaný náznak nikdy neobsahuje celou hodnotu tokenu", () => {
    const secrets = [
      SAMPLES.awsKeyId,
      SAMPLES.githubToken,
      SAMPLES.googleKey,
      SAMPLES.slackToken,
      SAMPLES.stripeKey,
    ];
    for (const secret of secrets) {
      const [hit] = detectSecrets(`x = ${secret}`);
      assert(hit);
      // Celá hodnota se NESMÍ objevit v masce.
      expect(hit.masked.includes(secret)).toBe(false);
      // Maska smí ukázat jen krátký veřejný prefix.
      expect(hit.masked).toMatch(/…\(\d+ znaků\)$/);
    }
  });

  it("maska ukáže délku a prefix, ne tělo", () => {
    const [hit] = detectSecrets(`x = ${SAMPLES.awsKeyId}`);
    assert(hit);
    expect(hit.masked).toBe(`AKIA…(${SAMPLES.awsKeyId.length} znaků)`);
  });

  it("maska nikdy neodhalí víc než krátký prefix (≤ 8 znaků před …)", () => {
    // Pojistka proti budoucí chybě v prefixLen: i kdyby někdo nastavil prefix
    // delší než tělo, nesmí uniknout víc než pár veřejných znaků.
    const samples = [
      SAMPLES.awsKeyId,
      SAMPLES.githubToken,
      SAMPLES.googleKey,
      SAMPLES.slackToken,
      SAMPLES.stripeKey,
    ];
    for (const s of samples) {
      const [hit] = detectSecrets(`x = ${s}`);
      assert(hit);
      const shown = hit.masked.split("…")[0];
      assert(shown !== undefined);
      expect(shown.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("detectSecrets – čísla řádků a opakované volání", () => {
  it("zásah ukazuje na správný 1-based řádek", () => {
    const text = ["// pozn", "// dalsi", `key = ${SAMPLES.awsKeyId}`].join("\n");
    const [hit] = detectSecrets(text);
    assert(hit);
    expect(hit.line).toBe(3);
  });

  it("opakované volání dává stejný výsledek (regex není stavový)", () => {
    const text = `a = ${SAMPLES.awsKeyId}`;
    const first = detectSecrets(text);
    const second = detectSecrets(text);
    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
  });

  it("CRLF i LF dávají stejná čísla řádků", () => {
    const lf = `x\ny = ${SAMPLES.awsKeyId}`;
    const crlf = `x\r\ny = ${SAMPLES.awsKeyId}`;
    const crlfHit = detectSecrets(crlf)[0];
    const lfHit = detectSecrets(lf)[0];
    assert(crlfHit);
    assert(lfHit);
    expect(crlfHit.line).toBe(lfHit.line);
    expect(crlfHit.line).toBe(2);
  });
});
