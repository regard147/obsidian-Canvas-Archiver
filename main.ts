import { Plugin, TFile, Notice, View, TAbstractFile } from 'obsidian';

interface CanvasNode {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: string;
    label?: string;
    styleAttributes: Record<string, unknown>;
}

interface GroupNode extends CanvasNode {
    type: 'group';
    label: string;
}

interface TextNode extends CanvasNode {
    type: 'text';
    text: string;
}

interface CanvasData {
    nodes: CanvasNode[];
    edges: any[];
    metadata: Record<string, unknown>;
}

// キャンバスビューの型定義
type CanvasViewType = View & {
    file: TFile;
    getViewData(): string;
    setViewData(data: string, clear: boolean): Promise<void>;
}

export default class CanvasArchiverPlugin extends Plugin {
    async onload(): Promise<void> {
        console.log('Loading Canvas Archiver plugin');

        // キャンバスのコマンドを追加
        this.addCommand({
            id: 'archive-blue-cards',
            name: 'Archive Blue Cards to Kanban',
            checkCallback: (checking: boolean) => {
                const canvasView = this.getActiveCanvasView();
                if (canvasView) {
                    if (!checking) {
                        this.archiveBlueCards(canvasView);
                    }
                    return true;
                }
                return false;
            }
        });

        // ツールバーにアーカイブボタンを追加
        const ribbonIconEl = this.addRibbonIcon('archive', 'Archive Blue Cards', async () => {
            const canvasView = this.getActiveCanvasView();
            if (canvasView) {
                await this.archiveBlueCards(canvasView);
            } else {
                new Notice('Please open a canvas file first');
            }
        });
    }

    private getActiveCanvasView(): CanvasViewType | null {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf && activeLeaf.view.getViewType() === 'canvas') {
            return activeLeaf.view as CanvasViewType;
        }
        return null;
    }

    // ノードがグループ内に存在するかチェック
    private isNodeInGroup(node: CanvasNode, group: GroupNode): boolean {
        return node.x >= group.x && 
               node.x + node.width <= group.x + group.width &&
               node.y >= group.y &&
               node.y + node.height <= group.y + group.height;
    }

    // ノードが属するグループを見つける
    private findNodeGroup(node: CanvasNode, groups: GroupNode[]): string {
        for (const group of groups) {
            if (this.isNodeInGroup(node, group)) {
                return group.label;
            }
        }
        return 'Uncategorized';
    }

    private async archiveBlueCards(canvasView: CanvasViewType): Promise<void> {
        try {
            const canvasData = JSON.parse(canvasView.getViewData()) as CanvasData;
            
            // グループノードを抽出
            const groupNodes = canvasData.nodes.filter((node): node is GroupNode => 
                node.type === 'group'
            );

            // 青いカードを抽出
            const blueCards = canvasData.nodes.filter((node): node is TextNode => 
                node.type === 'text' && 
                node.color === '6' // 6だったら青
            );

            if (blueCards.length === 0) {
                new Notice('No blue cards found to archive');
                return;
            }

            // カードをグループごとに整理
            const groupedCards = new Map<string, TextNode[]>();
            blueCards.forEach(card => {
                const groupName = this.findNodeGroup(card, groupNodes);
                if (!groupedCards.has(groupName)) {
                    groupedCards.set(groupName, []);
                }
                const cards = groupedCards.get(groupName);
                if (cards) {
                    cards.push(card);
                }
            });

            // Kanban形式のマークダウンを生成
            let kanbanContent = '';
            const fileName = `${canvasView.file.basename}-archive.md`;
            const parent = canvasView.file.parent;
            if (!parent) {
                throw new Error('Cannot determine parent folder for the canvas file');
            }
            const filePath = `${parent.path}/${fileName}`;

            // 既存のファイルがあればその内容を読み込む
            let existingContent = '';
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile instanceof TFile) {
                existingContent = await this.app.vault.read(existingFile);
                // ヘッダーがなければ追加
                if (!existingContent.startsWith('---\n\nkanban-plugin: basic\n\n---\n\n')) {
                    kanbanContent = '---\n\nkanban-plugin: basic\n\n---\n\n' + existingContent;
                } else {
                    kanbanContent = existingContent;
                }
            } else {
                kanbanContent = '---\n\nkanban-plugin: basic\n\n---\n\n';
            }

            // 新しいカードを追加
            for (const [group, cards] of groupedCards) {
                // グループが存在しない場合は新規作成
                if (!kanbanContent.includes(`## ${group}\n`)) {
                    kanbanContent += `\n## ${group}\n\n`;
                }
                cards.forEach(card => {
                    kanbanContent += `- [ ] ${card.text.replace(/\n/g, '<br>')}\n`;
                });
            }

            // ファイルを作成または更新
            if (existingFile instanceof TFile) {
                await this.app.vault.modify(existingFile, kanbanContent);
            } else {
                await this.app.vault.create(filePath, kanbanContent);
            }

            // アーカイブしたカードをキャンバスから削除
            const updatedNodes = canvasData.nodes.filter(node => 
                !(node.type === 'text' && node.color === '6')
            );
            const updatedCanvasData = {
                ...canvasData,
                nodes: updatedNodes
            };
            await canvasView.setViewData(JSON.stringify(updatedCanvasData), false);

            new Notice(`Archived ${blueCards.length} cards to ${fileName}`);

        } catch (error) {
            console.error('Error archiving cards:', error);
            new Notice('Error archiving cards. Check console for details.');
        }
    }

    onunload(): void {
        console.log('Canvas Archiver plugin unloaded');
    }
}
