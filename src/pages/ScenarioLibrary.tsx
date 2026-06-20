import { useNavigate } from 'react-router-dom';
import { mockScenarios } from '../data/mockScenarios';
import { formatDate, efScaleLabel } from '../utils/format';
import { getSavedScenarios } from '../utils/savedScenarios';
import { TornadoIcon } from '../components/TornadoIcon';

function ScenarioCard({
  name,
  region,
  efScale,
  pathLength,
  updatedAt,
  onOpen,
}: {
  name: string;
  region: string;
  efScale: number;
  pathLength: number;
  updatedAt: string;
  onOpen: () => void;
}) {
  return (
    <div className="group rounded-lg border border-gray-200 bg-white transition-colors hover:border-gray-400">
      <div className="px-5 pt-5 pb-4">
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {name}
        </h3>
        <p className="mt-1 text-xs text-gray-500">{region}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="font-medium text-gray-900">{efScaleLabel(efScale)}</span>
          <span>{pathLength} mi path</span>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
        <span className="text-[11px] text-gray-400">Updated {formatDate(updatedAt)}</span>
        <button
          onClick={onOpen}
          className="rounded px-3 py-1 text-xs font-medium text-gray-900 transition-colors hover:bg-gray-100"
        >
          Open scenario &rarr;
        </button>
      </div>
    </div>
  );
}

export function ScenarioLibrary() {
  const navigate = useNavigate();

  const builtInScenarios = [mockScenarios.find((s) => s.id === 'scenario-002')!];
  const userSaved = getSavedScenarios();
  const totalCount = builtInScenarios.length + userSaved.length;

  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <TornadoIcon className="text-gray-900" />
            <div>
              <h1 className="text-base font-semibold tracking-tight text-gray-900">TornadoReady</h1>
              <p className="text-[11px] leading-tight text-gray-400">
                Tornado preparedness simulation
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/workspace?mode=new')}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            New Scenario
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8">

          {/* Hero */}
          <div className="mb-10">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
              Scenario Library
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">
              Build tornado response scenarios, simulate hour-by-hour EMS and hospital surge,
              and generate preparedness reports.
            </p>
          </div>

          {/* Create new scenario */}
          <button
            onClick={() => navigate('/workspace?mode=new')}
            className="mb-10 flex w-full items-center gap-4 rounded-lg border border-dashed border-gray-300 bg-white px-6 py-5 text-left transition-colors hover:border-gray-400"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Create new tornado scenario
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Define a tornado path, community exposure, EMS resources, and hospital capacity.
              </p>
            </div>
          </button>

          {/* Saved scenarios */}
          <div>
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Saved Scenarios
              </h3>
              <span className="text-xs text-gray-400 tabular-nums">{totalCount} scenario{totalCount !== 1 ? 's' : ''}</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {builtInScenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  name={scenario.name}
                  region={scenario.region}
                  efScale={scenario.profile.efScale}
                  pathLength={scenario.impactPath.lengthMiles}
                  updatedAt={scenario.updatedAt}
                  onOpen={() => navigate(`/workspace?scenario=${scenario.id}`)}
                />
              ))}
              {userSaved.map((saved) => (
                <ScenarioCard
                  key={saved.id}
                  name={saved.name}
                  region={saved.region}
                  efScale={saved.efScale}
                  pathLength={saved.pathLengthMiles}
                  updatedAt={saved.updatedAt}
                  onOpen={() => navigate(`/workspace?saved=${saved.id}`)}
                />
              ))}
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-5xl px-6 py-4 lg:px-8">
          <p className="text-[11px] text-gray-400">
            TornadoReady simulations are for tornado preparedness planning and training support only.
          </p>
        </div>
      </footer>
    </div>
  );
}
