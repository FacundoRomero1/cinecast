type FullscreenSubscriber = (action?: 'toggle' | 'enter' | 'exit') => void;

class HubFullscreenService {
  private subscribers = new Set<FullscreenSubscriber>();
  private active = false;

  public subscribe(cb: FullscreenSubscriber): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  public toggle(): void {
    for (const sub of this.subscribers) {
      sub('toggle');
    }
  }

  public enter(): void {
    this.active = true;
    for (const sub of this.subscribers) {
      sub('enter');
    }
  }

  public exit(): void {
    this.active = false;
    for (const sub of this.subscribers) {
      sub('exit');
    }
  }

  public setActive(val: boolean): void {
    this.active = val;
  }

  public isActive(): boolean {
    return this.active;
  }
}

export const hubFullscreen = new HubFullscreenService();

