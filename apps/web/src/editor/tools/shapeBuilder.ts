import type { Editor } from '../editor';
import { buildShapes, pieceAt, shapeBuilderModel, SHAPE_BUILDER_MAX, type ShapeBuilderModel } from '../vectorActions';
import type { Tool, ToolEvent } from './types';

/**
 * Shape builder (Shift+M), as in Figma: with overlapping shapes selected,
 * click or drag across the regions they make to join them into one shape;
 * hold Alt to remove the regions instead. What's left of each shape stays.
 */
export class ShapeBuilderTool implements Tool {
  cursor = 'crosshair';
  private model: ShapeBuilderModel | null = null;
  private modelKey = '';
  private loading: Promise<ShapeBuilderModel | null> | null = null;
  private chosen: number[] | null = null;
  private remove = false;

  constructor(private ed: Editor) {}

  /** The regions of the current selection, recomputed when the file or selection changes. */
  private async regions(): Promise<ShapeBuilderModel | null> {
    const key = `${this.ed.doc.version}:${this.ed.ui.selection.join(',')}`;
    if (key === this.modelKey && !this.loading) return this.model;
    if (key === this.modelKey && this.loading) return this.loading;
    this.modelKey = key;
    this.loading = shapeBuilderModel(this.ed, this.ed.topLevelSelection());
    this.model = await this.loading;
    this.loading = null;
    return this.model;
  }

  private show(indices: number[], remove: boolean): void {
    const m = this.model;
    this.ed.setUI({ shapeHover: m && indices.length ? { pieces: indices.map((i) => m.pieces[i].paths), remove } : null });
  }

  async hover(e: ToolEvent): Promise<void> {
    if (this.chosen) return;
    const m = await this.regions();
    if (!m) return this.show([], false);
    const i = await pieceAt(m, e.world);
    this.show(i >= 0 ? [i] : [], e.alt);
  }

  async down(e: ToolEvent): Promise<void> {
    this.ed.commitTextEdit();
    const m = await this.regions();
    if (!m) {
      const n = this.ed.topLevelSelection().length;
      if (n === 0 || m === null) this.ed.setUI({ shapeHover: null });
      return;
    }
    this.remove = e.alt;
    const i = await pieceAt(m, e.world);
    this.chosen = i >= 0 ? [i] : [];
    this.show(this.chosen, this.remove);
  }

  async move(e: ToolEvent): Promise<void> {
    if (!this.chosen || !this.model) return;
    const i = await pieceAt(this.model, e.world);
    if (i >= 0 && !this.chosen.includes(i)) {
      this.chosen.push(i);
      this.show(this.chosen, this.remove);
    }
  }

  async up(_e: ToolEvent): Promise<void> {
    const chosen = this.chosen;
    this.chosen = null;
    this.ed.setUI({ shapeHover: null });
    if (!chosen?.length || !this.model) return;
    const created = await buildShapes(this.ed, this.model, chosen, this.remove);
    this.ed.doc.endGesture();
    this.modelKey = '';
    // Keep working on the result.
    if (created.length) this.ed.select(created);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ed.setTool('select');
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.chosen = null;
    this.model = null;
    this.modelKey = '';
    this.ed.setUI({ shapeHover: null });
  }
}

export { SHAPE_BUILDER_MAX };
