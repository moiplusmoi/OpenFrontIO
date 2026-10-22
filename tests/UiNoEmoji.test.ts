import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// Emoji are not interface icons: they render differently on every OS and
// clash with the line icons (`<of-icon>`). This is a ratchet, not a ban:
// files listed in KNOWN_EMOJI_FILES still carry emoji and are to be cleaned
// up; a file outside the list must stay emoji-free.
const EMOJI = /\p{Emoji_Presentation}|\p{Emoji}️/u;

const ROOT = join(__dirname, "..");
const CLIENT = join(ROOT, "src", "client");

const KNOWN_EMOJI_FILES = new Set<string>([
  "src/client/AccountModal.ts",
  "src/client/PlayerProfileModal.ts",
  "src/client/UserSettingModal.ts",
  "src/client/components/FriendsList.ts",
  "src/client/components/RewardsPanel.ts",
]);

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "render") continue; // WebGL code: not interface text
      yield* sourceFiles(path);
    } else if (name.endsWith(".ts") && name !== "EmojiKeys.ts") {
      yield path;
    }
  }
}

/** Code and HTML comments do not reach the screen. */
function isComment(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("*") ||
    t.startsWith("/*") ||
    t.startsWith("<!--")
  );
}

describe("interface emoji", () => {
  const scan = () => {
    const withEmoji = new Set<string>();
    for (const file of sourceFiles(CLIENT)) {
      const hasEmoji = readFileSync(file, "utf8")
        .split("\n")
        .some((line) => !isComment(line) && EMOJI.test(line));
      if (hasEmoji) withEmoji.add(relative(ROOT, file));
    }
    return withEmoji;
  };

  it("keeps emoji out of files that are not on the cleanup list", () => {
    const offenders = [...scan()].filter((rel) => !KNOWN_EMOJI_FILES.has(rel));
    expect(offenders).toEqual([]);
  });

  it("drops files from the cleanup list once they are clean", () => {
    const withEmoji = scan();
    const cleaned = [...KNOWN_EMOJI_FILES].filter((rel) => !withEmoji.has(rel));
    expect(cleaned).toEqual([]);
  });

  it("keeps emoji out of the English and French strings", () => {
    // The legal copyright line (AGPL §7) is the only exception.
    const EXEMPT = new Set(["main.copyright"]);
    for (const lang of ["en", "fr"]) {
      const dict = JSON.parse(
        readFileSync(join(ROOT, "resources", "lang", `${lang}.json`), "utf8"),
      );
      const bad: string[] = [];
      const walk = (node: unknown, path: string) => {
        if (typeof node === "string") {
          if (!EXEMPT.has(path) && EMOJI.test(node)) bad.push(path);
        } else if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node)) {
            walk(v, path ? `${path}.${k}` : k);
          }
        }
      };
      walk(dict, "");
      expect(bad, lang).toEqual([]);
    }
  });
});
