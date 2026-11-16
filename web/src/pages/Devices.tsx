import { ReadOnIpad } from '../components/ReadOnIpad'
import { SetUpKindle } from '../components/SetUpKindle'
import { PageHeader } from '../components/ui'

/** Putting the child's paper on a Kindle or an iPad: the addresses for the child shown now, and the steps. */
export function Devices() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Devices" subtitle="Put the paper on a Kindle or an iPad" />
      <SetUpKindle />
      <ReadOnIpad />
    </div>
  )
}
