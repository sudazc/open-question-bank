/** 屏蔽 Markdown 行内代码和围栏代码并保留字符位置 */
export function maskMarkdownCode(markdown: string): string {
  const characters = markdown.split('');
  let lineStart = 0;
  let fence: { marker: string; length: number } | undefined;
  let previousQuoteDepth: number | undefined;
  let previousLineBlank = true;
  let inIndentedCodeBlock = false;
  const listContentIndents: number[] = [];
  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex < 0 ? markdown.length : newlineIndex;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, '');
    const { content, quoteDepth } = stripBlockquotePrefixes(line);
    if (previousQuoteDepth !== undefined && quoteDepth !== previousQuoteDepth) {
      listContentIndents.length = 0;
      inIndentedCodeBlock = false;
      if (quoteDepth < previousQuoteDepth) {
        fence = undefined;
      }
    }
    previousQuoteDepth = quoteDepth;
    const indentation = getIndentation(content);
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
    const fenceMarker = fenceMatch?.[1];
    const fenceInfo = fenceMatch?.[2] ?? '';
    if (fence) {
      const closingMatch = /^ {0,3}(`+|~+)[ \t]*$/.exec(content);
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
      inIndentedCodeBlock = false;
      maskMarkdownRange(characters, lineStart, lineEnd);
    } else if (content.trim().length === 0) {
      previousLineBlank = true;
    } else {
      const listMarker = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(content.slice(indentation.endIndex));
      if (listMarker) {
        while (
          listContentIndents.length > 0 &&
          indentation.columns < (listContentIndents.at(-1) ?? 0)
        ) {
          listContentIndents.pop();
        }
        listContentIndents.push(
          getIndentationColumns(content.slice(0, indentation.endIndex + listMarker[0].length)),
        );
        inIndentedCodeBlock = false;
      } else {
        while (
          listContentIndents.length > 0 &&
          indentation.columns < (listContentIndents.at(-1) ?? 0)
        ) {
          listContentIndents.pop();
        }
        const codeIndent = (listContentIndents.at(-1) ?? 0) + 4;
        if (indentation.columns >= codeIndent && (previousLineBlank || inIndentedCodeBlock)) {
          inIndentedCodeBlock = true;
          maskMarkdownRange(characters, lineStart, lineEnd);
        } else {
          inIndentedCodeBlock = false;
        }
      }
      previousLineBlank = false;
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

function stripBlockquotePrefixes(line: string): { content: string; quoteDepth: number } {
  let cursor = 0;
  let quoteDepth = 0;
  while (cursor < line.length) {
    let quoteMarker = cursor;
    let spaces = 0;
    while (line[quoteMarker] === ' ' && spaces < 3) {
      quoteMarker += 1;
      spaces += 1;
    }
    if (line[quoteMarker] !== '>') {
      break;
    }
    cursor = quoteMarker + 1;
    if (line[cursor] === ' ' || line[cursor] === '\t') {
      cursor += 1;
    }
    quoteDepth += 1;
  }
  return { content: line.slice(cursor), quoteDepth };
}

function getIndentation(value: string): { columns: number; endIndex: number } {
  let columns = 0;
  let endIndex = 0;
  while (endIndex < value.length) {
    if (value[endIndex] === ' ') {
      columns += 1;
    } else if (value[endIndex] === '\t') {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
    endIndex += 1;
  }
  return { columns, endIndex };
}

function getIndentationColumns(value: string): number {
  let columns = 0;
  for (const character of value) {
    if (character === ' ') {
      columns += 1;
    } else if (character === '\t') {
      columns += 4 - (columns % 4);
    } else {
      columns += 1;
    }
  }
  return columns;
}

function maskMarkdownRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') {
      characters[index] = ' ';
    }
  }
}
