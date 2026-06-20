import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ScenarioLibrary } from './pages/ScenarioLibrary';
import { PlanningWorkspace } from './pages/PlanningWorkspace';
import { SimulationReview } from './pages/SimulationReview';
import { SimulationDashboard } from './pages/SimulationDashboard';
import { PreparednessReport } from './pages/PreparednessReport';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<ScenarioLibrary />} />
        <Route path="workspace" element={<PlanningWorkspace />} />
        <Route path="review" element={<SimulationReview />} />
        <Route path="simulation" element={<SimulationDashboard />} />
        <Route path="report" element={<PreparednessReport />} />
      </Routes>
    </BrowserRouter>
  );
}
