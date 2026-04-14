/**
 * Runtime execution tracker for ECMAScript spec section analysis.
 * Records which spec sections are entered during execution with deduplication.
 * Used for AI analysis of execution flow mapped to ECMAScript spec sections.
 */

/**
 * Represents a mark entry captured during execution.
 */
export interface MarkData {
  /** Array of ECMAScript spec section IDs (e.g., ["sec-array.prototype.every"]) */
  readonly sectionIds: string[];
  /** Relative file path from engine262/src/ directory */
  readonly fileRelativePath: string;
  /** Line number in source file (1-indexed) */
  readonly lineNumber: number;
  /** Whether this mark was captured during an "important" execution phase */
  readonly important: boolean;
}

/**
 * Runtime execution tracker that deduplicates marks by (sectionIds, file, line).
 * Provides chronological trace of spec section entry points during execution.
 */
class Ask262Debug {
  /** Collected mark entries with deduplication */
  marks: MarkData[] = [];

  /** Whether to mark new entries as important */
  private _important = false;

  /** Whether capture is enabled (controlled by startTrace/stopTrace) */
  private _captureEnabled = false;

  /** Map from deduplication key to index in marks array */
  private _markIndex = new Map<string, number>();

  /**
   * Creates a deduplication key from section IDs, file path, and line number.
   * @param sectionIds - Array of spec section IDs
   * @param file - Relative file path
   * @param line - Line number
   * @returns String key for deduplication
   */
  private _makeKey(sectionIds: string[], file: string, line: number): string {
    return `${sectionIds.join(',')}|${file}|${line}`;
  }

  /**
   * Records a mark for spec section entry during execution.
   * Deduplicates based on (sectionIds, file, line) combination.
   * If duplicate found, merges important flags (OR logic).
   * Only captures if tracing is enabled (via startTrace()).
   * @param sectionIds - Array of ECMAScript spec section IDs
   * @param file - Relative file path from engine262/src/
   * @param line - Line number in source file (1-indexed)
   */
  mark(sectionIds: string[], file: string, line: number) {
    if (!this._captureEnabled) {
      return;
    }

    const key = this._makeKey(sectionIds, file, line);
    const existingIndex = this._markIndex.get(key);

    if (existingIndex !== undefined) {
      // Merge important flag using OR logic
      const existing = this.marks[existingIndex];
      if (this._important && !existing.important) {
        (this.marks[existingIndex] as MarkData & { important: boolean }).important = true;
      }
      return;
    }

    const newMark: MarkData = {
      sectionIds: [...sectionIds], // defensive copy
      fileRelativePath: file,
      lineNumber: line,
      important: this._important,
    };

    this._markIndex.set(key, this.marks.length);
    this.marks.push(newMark);
  }

  /**
   * Enables capture of marks during execution.
   * Marks will be recorded until stopTrace() is called.
   */
  startTrace() {
    this._captureEnabled = true;
  }

  /**
   * Disables capture of marks during execution.
   * Marks will be ignored until startTrace() is called again.
   */
  stopTrace() {
    this._captureEnabled = false;
  }

  /**
   * Marks subsequent mark() calls as important.
   * Used to annotate interesting execution phases.
   */
  startImportant() {
    this._important = true;
  }

  /**
   * Stops marking subsequent mark() calls as important.
   */
  stopImportant() {
    this._important = false;
  }

  /**
   * Resets all captured marks and internal state.
   * Clears marks array, mark index map, and resets flags.
   */
  reset() {
    this.marks = [];
    this._markIndex.clear();
    this._important = false;
    this._captureEnabled = false;
  }
}

export const ask262Debug = new Ask262Debug();
