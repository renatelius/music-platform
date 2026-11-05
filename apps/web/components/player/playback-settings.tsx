'use client';

import { EQ_BANDS_HZ, EQ_MAX_DB, EQ_PRESETS, type EqPresetName } from '@mp/audio-web';
import type { QualityPreference } from '@mp/player-core';
import { SectionCard, SegmentedControl } from '@mp/ui';
import { type ReactNode, useId } from 'react';

import { useI18n } from '../../lib/i18n-context';
import { usePlayer } from '../../lib/player-context';
import { EQ_PRESET_NAMES, matchPreset } from '../../lib/player-store';

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
        </div>

        <p className="text-sm text-fg-muted">{t('playback.hotkeys')}</p>
      </div>
    </SectionCard>
  );
}
