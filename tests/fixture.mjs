// Authored synthetic layout; no vendor reference text is redistributed.
export const fixture = `## API
\`\`\`typescript
type Vec2 = [number, number];
interface Target {
  click(target: number | Vec2): void;
  selectText(index: number, text: string): void;
  setValue(index: number, value: string): void;
  drag(from: Vec2, to: Vec2): void;
  performSecondaryAction(index: number, action: string): void;
}
type AppInfo = { id: string };
interface App extends Target { paste(text: string): void; }
type BrowserInfo = { id: string };
interface Browser { documentation(): Promise<string>; }
interface Tab extends Target { readonly id: string; }
declare const cua: { getState(): void; };
\`\`\`
## Native apps
Synthetic native instructions.
## Workflow
Synthetic workflow.
## Output
Synthetic output.
## Notes
Synthetic notes.
` + 'Example reference text. '.repeat(1000);
