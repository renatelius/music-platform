import { describe, expect, it } from 'vitest';

import { createTabCoordinator, type TabChannel, type TabMessage } from './tab-sync';

/** BroadcastChannel stand-in: delivers to every other member of the bus, never to itself. */
function bus() {
  const members: { channel: TabChannel; listeners: Set<(event: { data: unknown }) => void> }[] = [];
  const join = (): TabChannel => {
    const listeners = new Set<(event: { data: unknown }) => void>();
    const channel: TabChannel = {
      postMessage(message: TabMessage) {
        for (const member of members) {
          if (member.channel === channel) continue;
          for (const listener of member.listeners) listener({ data: message });
        }
      },
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener);
      },
    };
    members.push({ channel, listeners });
    return channel;
  };
  return { join };
}

describe('createTabCoordinator', () => {
  it('pauses the other tabs of the same account', () => {
    const b = bus();
    const paused: string[] = [];
    const tab = (tabId: string, userId: string) =>
      createTabCoordinator({
        channel: b.join(),
        tabId,
        userId,
        onOtherTabPlaying: () => paused.push(tabId),
      });
    const a = tab('a', 'u1');
    tab('b', 'u1');
    tab('c', 'u2');
    a.announcePlaying();
    expect(paused).toEqual(['b']);
  });

  it('ignores foreign messages and stops listening after dispose', () => {
    const b = bus();
    let pauses = 0;
    const own = createTabCoordinator({
      channel: b.join(),
      tabId: 'a',
      userId: 'u1',
      onOtherTabPlaying: () => (pauses += 1),
    });
    const other = b.join();
    other.postMessage({ type: 'nope', tabId: 'x', userId: 'u1' } as unknown as TabMessage);
    other.postMessage({ type: 'playing', tabId: 'x', userId: 'u1' });
    expect(pauses).toBe(1);
    own.dispose();
    other.postMessage({ type: 'playing', tabId: 'x', userId: 'u1' });
    expect(pauses).toBe(1);
  });
});
