import { colorOf, type ColorAssignment } from '../app/colors';
import type { Finding } from '../engine/diagnostics';
import type { AxeptioProject } from '../engine/types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

interface DiagnosticsProps {
  project: AxeptioProject;
  findings: Finding[];
  colors: ColorAssignment;
  preview: boolean;
  activeFinding: string | null;
  onShow: (finding: Finding | null) => void;
  onIsolate: (id: string) => void;
}

const SEVERITY_ICON = { error: 'error', warning: 'warning', info: 'info' } as const;

export function Diagnostics({ project, findings, colors, preview, activeFinding, onShow, onIsolate }: DiagnosticsProps) {
  const { t, c } = useI18n();
  const names = new Map((project.cookies ?? []).map((cfg) => [cfg.identifier, cfg.name || cfg.title || cfg.identifier]));
  return (
    <div class="diagnostics">
      <p class="panel-intro">{t.diagnostics.intro}</p>
      {preview && <p class="panel-note">{t.diagnostics.previewNote}</p>}
      {findings.length === 0 && (
        <p class="all-good">
          <Icon name="check" /> {t.diagnostics.none}
        </p>
      )}
      <ul class="findings">
        {findings.map((f) => {
          const copy = t.diagnostics.finding(f, c);
          const active = activeFinding === f.id;
          return (
            <li key={f.id} class={`finding finding-${f.severity}${active ? ' active' : ''}`}>
              <div class="finding-head">
                <span class={`severity severity-${f.severity}`}>
                  <Icon name={SEVERITY_ICON[f.severity]} size={16} />
                  {t.diagnostics.severity[f.severity]}
                </span>
                <h3>{copy.title}</h3>
              </div>
              <p>
                <strong>{t.diagnostics.why}</strong> {copy.mechanism}
              </p>
              {copy.fix && (
                <p>
                  <strong>{t.diagnostics.fix}</strong> {copy.fix}
                </p>
              )}
              <div class="finding-actions">
                {f.configs
                  .filter((id) => names.has(id))
                  .map((id) => (
                    <button type="button" class="chip" key={id} onClick={() => onIsolate(id)} title={t.legend.isolate}>
                      <span class="chip-swatch" style={{ background: colorOf(colors, id) }} />
                      {names.get(id)}
                    </button>
                  ))}
                {f.regions.length > 0 && (
                  <button type="button" class="chip chip-action" aria-pressed={active} onClick={() => onShow(active ? null : f)}>
                    <Icon name="eye" size={14} />
                    {t.diagnostics.showOnMap}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
