import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { JobsProvider } from './components/JobsProvider'
import { Layout } from './components/Layout'
import { ProfileGate } from './components/ProfileGate'
import { SignedOutNotice } from './components/SignedOutNotice'
import { TooltipProvider } from './components/tooltip/TooltipProvider'
import { Find } from './pages/Find'
import { Day, IssueRedirect } from './pages/Day'
import { Devices } from './pages/Devices'
import { Issues } from './pages/Issues'
import { Ai } from './pages/Ai'
import { Calendar } from './pages/Calendar'
import { More } from './pages/More'
import { Reading } from './pages/Reading'
import { Runs } from './pages/Runs'
import { Share } from './pages/Share'
import { Story } from './pages/Story'
import { Today } from './pages/Today'
import { Topics } from './pages/Topics'
import { Sport } from './pages/Sport'
import { basenameFor } from './lib/profile'

// No login route in the app: Authelia on the cluster edge, or the server's own
// sign-in page (DASHBOARD_PASSWORD), signs the parent in before the page loads.
// An expired session is handled by the API client (reload once).
export function AppRoutes() {
  return (
    <JobsProvider>
      <TooltipProvider>
        <SignedOutNotice />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Today />} />
            <Route path="story/:id" element={<Story />} />
            <Route path="issues" element={<Issues />} />
            <Route path="issues/:date" element={<IssueRedirect />} />
            <Route path="day/:date" element={<Day />} />
            <Route path="find" element={<Find />} />
            <Route path="topics" element={<Topics />} />
            <Route path="sport" element={<Sport />} />
            <Route path="reading" element={<Reading />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="ai" element={<Ai />} />
            <Route path="share" element={<Share />} />
            <Route path="runs" element={<Runs />} />
            <Route path="devices" element={<Devices />} />
            <Route path="more" element={<More />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </JobsProvider>
  )
}

// With several children the router is mounted per child, at /dashboard/p/<id>
// (lib/profile.ts); with one it is at /dashboard as it always was.
export default function App() {
  return (
    <ProfileGate>
      {(mode) => (
        <BrowserRouter key={`${mode.prefixed}:${mode.id}`} basename={basenameFor(mode)}>
          <AppRoutes />
        </BrowserRouter>
      )}
    </ProfileGate>
  )
}
