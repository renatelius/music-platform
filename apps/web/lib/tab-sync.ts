/** What tabs of the same browser tell each other about playback (B4). */
export interface TabMessage {
  readonly type: 'playing';
  readonly tabId: string;
  readonly userId: string;
}

/** The subset of BroadcastChannel the coordinator needs (a fake in tests). */
export interface TabChannel {
  postMessage(message: TabMessage): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

function isTabMessage(value: unknown): value is TabMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === 'playing' &&
    typeof message.tabId === 'string' &&
    typeof message.userId === 'string'
  );
}

export interface TabCoordinatorOptions {
  readonly channel: TabChannel;
  readonly tabId: string;
  readonly userId: string;
  /** Another tab of the same account started playing: this one should pause. */
  readonly onOtherTabPlaying: () => void;
}

/**
 * Only one tab plays at a time: a tab that starts playing tells the others, and they pause.
 * Tabs of another account (shared computer) are left alone.
 */
export function createTabCoordinator(options: TabCoordinatorOptions) {
  const listener = (event: { data: unknown }) => {
    const message = event.data;
    if (!isTabMessage(message)) return;
    if (message.tabId === options.tabId || message.userId !== options.userId) return;
    options.onOtherTabPlaying();
  };
  options.channel.addEventListener('message', listener);
  return {
    /** Call when this tab starts playing. */
    announcePlaying(): void {
      options.channel.postMessage({
        type: 'playing',
        tabId: options.tabId,
        userId: options.userId,
      });
    },
    dispose(): void {
      options.channel.removeEventListener('message', listener);
    },
  };
}
