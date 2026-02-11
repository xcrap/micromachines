export class InputManager {
  private keys: Map<string, boolean> = new Map();

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'q', 'a', 'o', 'p'].includes(key)) {
      event.preventDefault();
    }
    this.keys.set(key, true);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.set(event.key.toLowerCase(), false);
  };

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  public isKeyPressed(key: string): boolean {
    return this.keys.get(key.toLowerCase()) === true;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.keys.clear();
  }
}
