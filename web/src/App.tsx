import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { JobsProvider } from './components/JobsProvider'
import { Layout } from './components/Layout'
import { SignedOutNotice } from './components/SignedOutNotice'
import { TooltipProvider } from './components/tooltip/TooltipProvider'
import { BASE_PATH } from './config'
import { Find } from './pages/Find'
import { IssueDetail } from './pages/IssueDetail'
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

// No login route: Authelia on the cluster edge signs the parent in before the
// page loads. An expired session is handled by the API client (reload once).
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
            <Route path="issues/:date" element={<IssueDetail />} />
            <Route path="find" element={<Find />} />
            <Route path="topics" element={<Topics />} />
            <Route path="reading" element={<Reading />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="ai" element={<Ai />} />
            <Route path="share" element={<Share />} />
            <Route path="runs" element={<Runs />} />
            <Route path="more" element={<More />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </JobsProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={BASE_PATH.replace(/\/$/, '')}>
      <AppRoutes />
    </BrowserRouter>
  )
}
