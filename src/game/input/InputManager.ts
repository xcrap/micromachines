export class InputManager {
  private keys: Map<string, boolean> = new Map();

  constructor() {
    // Set up event listeners
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Prevent default behavior for game control keys to avoid page scrolling
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'q', 'a', 'o', 'p'].includes(event.key.toLowerCase())) {
      event.preventDefault();
    }
    
    this.keys.set(event.key.toLowerCase(), true);
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.set(event.key.toLowerCase(), false);
  }

  public isKeyPressed(key: string): boolean {
    return this.keys.get(key.toLowerCase()) === true;
  }

  public dispose(): void {
    // Remove event listeners
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
    window.removeEventListener('keyup', this.onKeyUp.bind(this));
    
    // Clear keys
    this.keys.clear();
  }
}