'use client';

import { EQ_BANDS_HZ, EQ_MAX_DB, EQ_PRESETS, type EqPresetName } from '@mp/audio-web';
import type { QualityPreference } from '@mp/player-core';
import { cn, IconX, SectionCard, SegmentedControl } from '@mp/ui';
import { type ReactNode, useId, useState } from 'react';

import { useI18n } from '../../lib/i18n-context';
import { usePlayer } from '../../lib/player-context';
import {
  EQ_PRESET_NAMES,
  matchPreset,
  matchProfile,
  MAX_EQ_PROFILE_NAME,
  MAX_EQ_PROFILES,
  removeEqProfile,
  saveEqProfile,
  type WebPlayerSettings,
} from '../../lib/player-store';

const bandLabel = (hz: number) => (hz >= 1000 ? `${String(hz / 1000)}k` : String(hz));
const CUSTOM = 'custom';

function Checkbox({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
      />
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-fg">
          {label}
        </label>
        {hint !== undefined ? (
          <p id={`${id}-hint`} className="text-sm text-fg-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg">{label}</p>
      {children}
      {hint !== undefined ? <p className="text-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}

/** −1..1 slider; snaps to the centre near zero. */
function BalanceControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (balance: number) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const percent = Math.round(Math.abs(value) * 100);
  const text =
    percent === 0
      ? t('playback.balance.center')
      : value < 0
        ? t('playback.balance.left', { percent })
        : t('playback.balance.right', { percent });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {t('playback.balance')}
        </label>
        <span className="text-sm text-fg-muted tabular-nums">{text}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <span aria-hidden="true">L</span>
        <input
          id={id}
          type="range"
          min={-100}
          max={100}
          step={5}
          value={Math.round(value * 100)}
          aria-valuetext={text}
          onChange={(event) => {
            onChange(Number(event.target.value) / 100);
          }}
          onDoubleClick={() => {
            onChange(0);
          }}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent"
        />
        <span aria-hidden="true">R</span>
      </div>
    </div>
  );
}

/** Saved equalizer profiles: apply with a click, save the current bands under a name. */
function EqProfiles({
  settings,
  update,
}: {
  settings: WebPlayerSettings;
  update: (patch: Partial<WebPlayerSettings>) => void;
}) {
  const { t } = useI18n();
  const nameId = useId();
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const active = settings.eqEnabled ? matchProfile(settings.eqProfiles, settings.eqGains) : null;

  const save = () => {
    const result = saveEqProfile(settings.eqProfiles, name, settings.eqGains);
    if (!result.ok) {
      const text = {
        empty: t('playback.eq.profileError.empty'),
        tooLong: t('playback.eq.profileError.tooLong', { max: MAX_EQ_PROFILE_NAME }),
        full: t('playback.eq.profileError.full', { max: MAX_EQ_PROFILES }),
      }[result.reason];
      setMessage({ kind: 'error', text });
      return;
    }
    update({ eqProfiles: result.profiles, eqEnabled: true });
    setMessage({ kind: 'ok', text: t('playback.eq.profileSaved', { name: name.trim() }) });
    setName('');
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg-muted">{t('playback.eq.profiles')}</p>
      {settings.eqProfiles.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t('playback.eq.noProfiles')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {settings.eqProfiles.map((profile) => (
            <li
              key={profile.name}
              className={cn(
                'flex items-center rounded-full border text-sm',
                active?.name === profile.name
                  ? 'border-accent text-accent'
                  : 'border-border text-fg',
              )}
            >
              <button
                type="button"
                aria-pressed={active?.name === profile.name}
                aria-label={t('playback.eq.applyProfile', { name: profile.name })}
                onClick={() => {
                  update({ eqGains: profile.gains, eqEnabled: true });
                }}
                className="max-w-48 truncate rounded-l-full py-1 pr-1 pl-3 hover:bg-surface"
              >
                {profile.name}
              </button>
              <button
                type="button"
                aria-label={t('playback.eq.deleteProfile', { name: profile.name })}
                title={t('playback.eq.deleteProfile', { name: profile.name })}
                onClick={() => {
                  update({ eqProfiles: removeEqProfile(settings.eqProfiles, profile.name) });
                }}
                className="rounded-r-full py-1 pr-2 pl-1 text-fg-muted hover:bg-surface hover:text-fg"
              >
                <IconX className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label htmlFor={nameId} className="sr-only">
          {t('playback.eq.profileName')}
        </label>
        <input
          id={nameId}
          value={name}
          maxLength={MAX_EQ_PROFILE_NAME + 10}
          placeholder={t('playback.eq.profileName')}
          onChange={(event) => {
            setName(event.target.value);
            setMessage(null);
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle"
        />
        <button
          type="submit"
          className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-fg hover:bg-surface"
        >
          {t('playback.eq.saveProfile')}
        </button>
      </form>
      {message !== null ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={cn('text-sm', message.kind === 'error' ? 'text-danger' : 'text-fg-muted')}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** Account page, «Playback»: applied at once and kept on this device. */
export function PlaybackSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = usePlayer();
  const crossfadeId = useId();
  const presetId = useId();
  const preset = matchPreset(settings.eqGains);
  const seconds = Math.round(settings.crossfadeMs / 1000);

  const qualityOptions: { value: QualityPreference; label: string }[] = [
    { value: 'auto', label: t('playback.quality.auto') },
    { value: 'data-saver', label: t('playback.quality.dataSaver') },
    { value: 'lossless', label: t('playback.quality.lossless') },
  ];

  return (
    <SectionCard title={t('playback.title')} description={t('playback.subtitle')}>
      <div className="flex flex-col gap-6">
        <Field label={t('playback.quality')} hint={t('playback.quality.hint')}>
          <SegmentedControl
            label={t('playback.quality')}
            value={settings.quality}
            options={qualityOptions}
            onChange={(quality) => {
              updateSettings({ quality });
            }}
          />
        </Field>

        <Field label={t('playback.replayGain')} hint={t('playback.replayGain.hint')}>
          <SegmentedControl
            label={t('playback.replayGain')}
            value={settings.replayGain}
            options={[
              { value: 'track', label: t('playback.replayGain.on') },
              { value: 'off', label: t('playback.replayGain.off') },
            ]}
            onChange={(replayGain) => {
              updateSettings({ replayGain });
            }}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={crossfadeId} className="text-sm font-medium text-fg">
              {t('playback.crossfade')}
            </label>
            <span className="text-sm text-fg-muted tabular-nums">
              {seconds === 0
                ? t('playback.crossfade.off')
                : t('playback.crossfade.value', { seconds })}
            </span>
          </div>
          <input
            id={crossfadeId}
            type="range"
            min={0}
            max={12}
            step={1}
            value={seconds}
            onChange={(event) => {
              updateSettings({ crossfadeMs: Number(event.target.value) * 1000 });
            }}
            className="h-1.5 w-full cursor-pointer accent-accent"
          />
          <Checkbox
            label={t('playback.gaplessAlbums')}
            hint={t('playback.gaplessAlbums.hint')}
            checked={settings.gaplessAlbums}
            onChange={(gaplessAlbums) => {
              updateSettings({ gaplessAlbums });
            }}
          />
        </div>

        <BalanceControl
          value={settings.balance}
          onChange={(balance) => {
            updateSettings({ balance });
          }}
        />

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-fg">{t('playback.eq')}</p>
          <Checkbox
            label={t('playback.eq.enabled')}
            checked={settings.eqEnabled}
            onChange={(eqEnabled) => {
              updateSettings({ eqEnabled });
            }}
          />
          <div className="flex items-center gap-3">
            <label htmlFor={presetId} className="text-sm text-fg-muted">
              {t('playback.eq.preset')}
            </label>
            <select
              id={presetId}
              value={preset ?? CUSTOM}
              disabled={!settings.eqEnabled}
              onChange={(event) => {
                const name = event.target.value;
                if (name === CUSTOM) return;
                updateSettings({ eqGains: EQ_PRESETS[name as EqPresetName] });
              }}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-fg disabled:opacity-50"
            >
              {EQ_PRESET_NAMES.map((name) => (
                <option key={name} value={name}>
                  {t(`playback.eq.${name}`)}
                </option>
              ))}
              {preset === null ? <option value={CUSTOM}>{t('playback.eq.custom')}</option> : null}
            </select>
          </div>
          <div
            className={`grid grid-cols-10 gap-1 rounded-xl border border-border p-3 ${settings.eqEnabled ? '' : 'opacity-50'}`}
          >
            {EQ_BANDS_HZ.map((hz, band) => {
              const gain = settings.eqGains[band] ?? 0;
              return (
                <div key={hz} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-fg-subtle tabular-nums">
                    {gain > 0 ? `+${String(gain)}` : String(gain)}
                  </span>
                  <input
                    type="range"
                    min={-EQ_MAX_DB}
                    max={EQ_MAX_DB}
                    step={1}
                    value={gain}
                    disabled={!settings.eqEnabled}
                    aria-label={`${bandLabel(hz)} Hz`}
                    aria-valuetext={`${String(gain)} dB`}
                    onChange={(event) => {
                      const gains = [...settings.eqGains];
                      gains[band] = Number(event.target.value);
                      updateSettings({ eqGains: gains });
                    }}
                    className="h-24 w-5 cursor-pointer accent-accent [direction:rtl] [writing-mode:vertical-lr] disabled:cursor-default"
                  />
                  <span className="text-[10px] text-fg-muted">{bandLabel(hz)}</span>
                </div>
              );
            })}
          </div>
          <EqProfiles settings={settings} update={updateSettings} />
        </div>

        <p className="text-sm text-fg-muted">{t('playback.hotkeys')}</p>
      </div>
    </SectionCard>
  );
}
