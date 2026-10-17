/** 屏蔽 Markdown 行内代码和围栏代码并保留字符位置 */
export function maskMarkdownCode(markdown: string): string {
  const characters = markdown.split('');
  let lineStart = 0;
  let fence: { marker: string; length: number } | undefined;
  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex < 0 ? markdown.length : newlineIndex;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const fenceMarker = fenceMatch?.[1];
    const fenceInfo = fenceMatch?.[2] ?? '';
    if (fence) {
      const closingMatch = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      maskMarkdownRange(characters, lineStart, lineEnd);
      const closingMarker = closingMatch?.[1];
      if (
        closingMarker &&
        closingMarker[0] === fence.marker &&
        closingMarker.length >= fence.length
      ) {
        fence = undefined;
      }
    } else if (fenceMarker && !(fenceMarker[0] === '`' && fenceInfo.includes('`'))) {
      fence = { marker: fenceMarker[0] ?? '', length: fenceMarker.length };
      maskMarkdownRange(characters, lineStart, lineEnd);
    }
    lineStart = newlineIndex < 0 ? markdown.length : newlineIndex + 1;
  }

  const masked = characters.join('');
  const backtick = String.fromCharCode(96);
  const runs: Array<{ start: number; end: number; length: number }> = [];
  let index = 0;
  let backslashCount = 0;
  while (index < masked.length) {
    if (masked[index] === '\\') {
      backslashCount += 1;
      index += 1;
      continue;
    }
    if (masked[index] !== backtick) {
      backslashCount = 0;
      index += 1;
      continue;
    }
    const start = index;
    let runLength = 1;
    while (masked[index + runLength] === backtick) {
      runLength += 1;
    }
    const escaped = backslashCount % 2 === 1;
    const delimiterLength = runLength - (escaped ? 1 : 0);
    if (delimiterLength > 0) {
      const delimiterStart = start + (escaped ? 1 : 0);
      runs.push({
        start: delimiterStart,
        end: start + runLength,
        length: delimiterLength,
      });
    }
    backslashCount = 0;
    index += runLength;
  }

  const nextRunIndices: Array<number | undefined> = new Array(runs.length);
  const latestRunByLength = new Map<number, number>();
  for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
    const run = runs[runIndex];
    if (!run) {
      continue;
    }
    nextRunIndices[runIndex] = latestRunByLength.get(run.length);
    latestRunByLength.set(run.length, runIndex);
  }
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    if (!run) {
      continue;
    }
    const closingRunIndex = nextRunIndices[runIndex];
    const closingRun = closingRunIndex === undefined ? undefined : runs[closingRunIndex];
    if (closingRunIndex === undefined || !closingRun) {
      continue;
    }
    maskMarkdownRange(characters, run.start, closingRun.end);
    runIndex = closingRunIndex;
  }
  return characters.join('');
}

function maskMarkdownRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') {
      characters[index] = ' ';
    }
  }
}
