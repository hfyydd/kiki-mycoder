import { DiffLine } from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { streamDiffLines } from "core/edit/streamDiffLines";
import { pruneLinesFromBottom, pruneLinesFromTop } from "core/llm/countTokens";
import { getMarkdownLanguageTagForFile } from "core/util";
import * as vscode from "vscode";

import EditDecorationManager from "../../quickEdit/EditDecorationManager";
import { VsCodeWebviewProtocol } from "../../webviewProtocol";

import { VerticalDiffHandler, VerticalDiffHandlerOptions } from "./handler";

/**
 * 垂直差异代码镜头的接口定义
 * 用于在编辑器中可视化展示代码差异
 */
export interface VerticalDiffCodeLens {
  /** 差异部分的起始行号 */
  start: number;
  /** 被删除的行数（显示为红色） */
  numRed: number;
  /** 新增的行数（显示为绿色） */
  numGreen: number;
}

/**
 * 垂直差异管理器类
 * 负责管理VS Code编辑器中的垂直差异可视化
 * 包括创建、更新和清理差异装饰器
 */
export class VerticalDiffManager {
  /** 刷新代码镜头的回调函数 */
  public refreshCodeLens: () => void = () => {};

  /** 存储文件路径到其对应差异处理器的映射 */
  private filepathToHandler: Map<string, VerticalDiffHandler> = new Map();

  /** 存储文件路径到其代码镜头信息的映射 */
  filepathToCodeLens: Map<string, VerticalDiffCodeLens[]> = new Map();

  /** 用户文档变更监听器 */
  private userChangeListener: vscode.Disposable | undefined;

  /** 存储当前的差异行用于日志记录 */
  logDiffs: DiffLine[] | undefined;

  /**
   * 创建垂直差异管理器的实例
   * @param configHandler - 配置处理器，用于管理配置设置
   * @param webviewProtocol - 用于与webview通信的协议
   * @param editDecorationManager - 编辑器装饰器管理器
   */
  constructor(
    private readonly configHandler: ConfigHandler,
    private readonly webviewProtocol: VsCodeWebviewProtocol,
    private readonly editDecorationManager: EditDecorationManager,
  ) {
    this.userChangeListener = undefined;
  }

  /**
   * 为指定文件创建垂直差异处理器
   * @param filepath - 需要处理差异的文件路径
   * @param startLine - 差异部分的起始行
   * @param endLine - 差异部分的结束行
   * @param options - 差异处理器的配置选项
   * @returns 创建的差异处理器，如果创建失败则返回undefined
   */
  createVerticalDiffHandler(
    filepath: string,
    startLine: number,
    endLine: number,
    options: VerticalDiffHandlerOptions,
  ) {
    if (this.filepathToHandler.has(filepath)) {
      this.filepathToHandler.get(filepath)?.clear(false);
      this.filepathToHandler.delete(filepath);
    }
    const editor = vscode.window.activeTextEditor; // TODO
    if (editor && editor.document.uri.fsPath === filepath) {
      const handler = new VerticalDiffHandler(
        startLine,
        endLine,
        editor,
        this.filepathToCodeLens,
        this.clearForFilepath.bind(this),
        this.refreshCodeLens,
        options,
      );
      this.filepathToHandler.set(filepath, handler);
      return handler;
    } else {
      return undefined;
    }
  }

  /**
   * 获取指定文件的差异处理器
   * @param filepath - 文件路径
   * @returns 该文件的差异处理器（如果存在）
   */
  getHandlerForFile(filepath: string) {
    return this.filepathToHandler.get(filepath);
  }

  /**
   * 创建用户文档变更的监听器
   * 每个文件只创建一个监听器以避免重复
   * @returns 事件监听器的可释放对象
   * @private
   */
  private enableDocumentChangeListener(): vscode.Disposable | undefined {
    if (this.userChangeListener) {
      //Only create one listener per file
      return;
    }

    this.userChangeListener = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        // Check if there is an active handler for the affected file
        const filepath = event.document.uri.fsPath;
        const handler = this.getHandlerForFile(filepath);
        if (handler) {
          // If there is an active diff for that file, handle the document change
          this.handleDocumentChange(event, handler);
        }
      },
    );
  }

  /**
   * 禁用文档变更监听器
   * 在Continue进行更新时使用，以防止干扰
   * @public
   */
  public disableDocumentChangeListener() {
    if (this.userChangeListener) {
      this.userChangeListener.dispose();
      this.userChangeListener = undefined;
    }
  }

  /**
   * 处理文档变更，更新差异可视化
   * @param event - 文档变更事件
   * @param handler - 变更文件的差异处理器
   * @private
   */
  private handleDocumentChange(
    event: vscode.TextDocumentChangeEvent,
    handler: VerticalDiffHandler,
  ) {
    // Loop through each change in the event
    event.contentChanges.forEach((change) => {
      // Calculate the number of lines added or removed
      const linesAdded = change.text.split("\n").length - 1;
      const linesDeleted = change.range.end.line - change.range.start.line;
      const lineDelta = linesAdded - linesDeleted;

      // Update the diff handler with the new line delta
      handler.updateLineDelta(
        event.document.uri.fsPath,
        change.range.start.line,
        lineDelta,
      );
    });
  }

  /**
   * 清理指定文件的差异可视化
   * @param filepath - 文件路径
   * @param accept - 是否接受变更
   */
  clearForFilepath(filepath: string | undefined, accept: boolean) {
    if (!filepath) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      filepath = activeEditor.document.uri.fsPath;
    }

    const handler = this.filepathToHandler.get(filepath);
    if (handler) {
      handler.clear(accept);
      this.filepathToHandler.delete(filepath);
    }

    this.disableDocumentChangeListener();

    vscode.commands.executeCommand("setContext", "continue.diffVisible", false);
  }

  /**
   * 接受或拒绝垂直差异块
   * @param accept - 是否接受变更
   * @param filepath - 文件路径
   * @param index - 差异块的索引
   */
  async acceptRejectVerticalDiffBlock(
    accept: boolean,
    filepath?: string,
    index?: number,
  ) {
    if (!filepath) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      filepath = activeEditor.document.uri.fsPath;
    }

    if (typeof index === "undefined") {
      index = 0;
    }

    const blocks = this.filepathToCodeLens.get(filepath);
    const block = blocks?.[index];
    if (!blocks || !block) {
      return;
    }

    const handler = this.getHandlerForFile(filepath);
    if (!handler) {
      return;
    }

    // Disable listening to file changes while continue makes changes
    this.disableDocumentChangeListener();

    // CodeLens object removed from editorToVerticalDiffCodeLens here
    await handler.acceptRejectBlock(
      accept,
      block.start,
      block.numGreen,
      block.numRed,
    );

    if (blocks.length === 1) {
      this.clearForFilepath(filepath, true);
    } else {
      // Re-enable listener for user changes to file
      this.enableDocumentChangeListener();
    }

    this.refreshCodeLens();
  }

  /**
   * 流式处理文件的差异行
   * @param diffStream - 差异流
   * @param instant - 是否立即应用差异
   * @param streamId - 流ID
   */
  async streamDiffLines(
    diffStream: AsyncGenerator<DiffLine>,
    instant: boolean,
    streamId?: string,
  ) {
    vscode.commands.executeCommand("setContext", "continue.diffVisible", true);

    // Get the current editor filepath/range
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const filepath = editor.document.uri.fsPath;
    const startLine = 0;
    const endLine = editor.document.lineCount - 1;

    // Check for existing handlers in the same file the new one will be created in
    const existingHandler = this.getHandlerForFile(filepath);
    if (existingHandler) {
      existingHandler.clear(false);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });

    // Create new handler with determined start/end
    const diffHandler = this.createVerticalDiffHandler(
      filepath,
      startLine,
      endLine,
      {
        instant,
        onStatusUpdate: (status, numDiffs, fileContent) =>
          void this.webviewProtocol.request("updateApplyState", {
            streamId,
            status,
            numDiffs,
            fileContent,
            filepath,
          }),
      },
    );

    if (!diffHandler) {
      console.warn("Issue occured while creating new vertical diff handler");
      return;
    }

    if (editor.selection) {
      // Unselect the range
      editor.selection = new vscode.Selection(
        editor.selection.active,
        editor.selection.active,
      );
    }

    vscode.commands.executeCommand(
      "setContext",
      "continue.streamingDiff",
      true,
    );

    try {
      this.logDiffs = await diffHandler.run(diffStream);

      // enable a listener for user edits to file while diff is open
      this.enableDocumentChangeListener();
    } catch (e) {
      this.disableDocumentChangeListener();
      vscode.window.showErrorMessage(`Error streaming diff: ${e}`);
    } finally {
      vscode.commands.executeCommand(
        "setContext",
        "continue.streamingDiff",
        false,
      );
    }
  }

  /**
   * 流式处理文件编辑
   * @param input - 输入文本
   * @param modelTitle - 模型标题
   * @param streamId - 流ID
   * @param onlyOneInsertion - 是否只允许一次插入
   * @param quickEdit - 快速编辑文本
   * @param range - 编辑范围
   * @returns 编辑后的文本
   */
  async streamEdit(
    input: string,
    modelTitle: string | undefined,
    streamId?: string,
    onlyOneInsertion?: boolean,
    quickEdit?: string,
    range?: vscode.Range,
  ): Promise<string | undefined> {
    vscode.commands.executeCommand("setContext", "continue.diffVisible", true);

    let editor = vscode.window.activeTextEditor;

    if (!editor) {
      return undefined;
    }

    const filepath = editor.document.uri.fsPath;

    let startLine, endLine: number;

    if (range) {
      startLine = range.start.line;
      endLine = range.end.line;
    } else {
      startLine = editor.selection.start.line;
      endLine = editor.selection.end.line;
    }

    // Check for existing handlers in the same file the new one will be created in
    const existingHandler = this.getHandlerForFile(filepath);

    if (existingHandler) {
      if (quickEdit) {
        // Previous diff was a quickEdit
        // Check if user has highlighted a range
        let rangeBool =
          startLine != endLine ||
          editor.selection.start.character != editor.selection.end.character;

        // Check if the range is different from the previous range
        let newRangeBool =
          startLine != existingHandler.range.start.line ||
          endLine != existingHandler.range.end.line;

        if (!rangeBool || !newRangeBool) {
          // User did not highlight a new range -> use start/end from the previous quickEdit
          startLine = existingHandler.range.start.line;
          endLine = existingHandler.range.end.line;
        }
      }

      // Clear the previous handler
      // This allows the user to edit above the changed area,
      // but extra delta was added for each line generated by Continue
      // Before adding this back, we need to distinguish between human and Continue
      // let effectiveLineDelta =
      //   existingHandler.getLineDeltaBeforeLine(startLine);
      // startLine += effectiveLineDelta;
      // endLine += effectiveLineDelta;

      existingHandler.clear(false);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });

    // Create new handler with determined start/end
    const diffHandler = this.createVerticalDiffHandler(
      filepath,
      startLine,
      endLine,
      {
        input,
        onStatusUpdate: (status, numDiffs, fileContent) =>
          streamId &&
          void this.webviewProtocol.request("updateApplyState", {
            streamId,
            status,
            numDiffs,
            fileContent,
            filepath,
          }),
      },
    );

    if (!diffHandler) {
      console.warn("Issue occured while creating new vertical diff handler");
      return undefined;
    }

    let selectedRange = diffHandler.range;

    // Only if the selection is empty, use exact prefix/suffix instead of by line
    if (selectedRange.isEmpty) {
      selectedRange = new vscode.Range(
        editor.selection.start.with(undefined, 0),
        editor.selection.end.with(undefined, Number.MAX_SAFE_INTEGER),
      );
    }

    const llm = await this.configHandler.llmFromTitle(modelTitle);
    const rangeContent = editor.document.getText(selectedRange);
    const prefix = pruneLinesFromTop(
      editor.document.getText(
        new vscode.Range(new vscode.Position(0, 0), selectedRange.start),
      ),
      llm.contextLength / 4,
      llm.model,
    );
    const suffix = pruneLinesFromBottom(
      editor.document.getText(
        new vscode.Range(
          selectedRange.end,
          new vscode.Position(editor.document.lineCount, 0),
        ),
      ),
      llm.contextLength / 4,
      llm.model,
    );

    if (editor.selection) {
      // Unselect the range
      editor.selection = new vscode.Selection(
        editor.selection.active,
        editor.selection.active,
      );
    }

    vscode.commands.executeCommand(
      "setContext",
      "continue.streamingDiff",
      true,
    );

    this.editDecorationManager.clear();

    try {
      const streamedLines: string[] = [];

      async function* recordedStream() {
        const stream = streamDiffLines(
          prefix,
          rangeContent,
          suffix,
          llm,
          input,
          getMarkdownLanguageTagForFile(filepath),
          onlyOneInsertion,
        );

        for await (const line of stream) {
          if (line.type === "new" || line.type === "same") {
            streamedLines.push(line.line);
          }
          yield line;
        }
      }

      this.logDiffs = await diffHandler.run(recordedStream());

      // enable a listener for user edits to file while diff is open
      this.enableDocumentChangeListener();

      return `${prefix}${streamedLines.join("\n")}${suffix}`;
    } catch (e) {
      this.disableDocumentChangeListener();
      vscode.window.showErrorMessage(`Error streaming diff: ${e}`);
      return undefined;
    } finally {
      vscode.commands.executeCommand(
        "setContext",
        "continue.streamingDiff",
        false,
      );
    }
  }
}
