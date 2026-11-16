import { useChildAddresses } from '../lib/profile'
import { Address, GuessedAddressNote, Path, Step, Steps } from './SetupParts'
import { Card, SectionTitle } from './ui'

const REPO = 'https://github.com/kris-g/early-edition-kids'
export const PLUGIN_RELEASE_URL = `${REPO}/releases/latest`
export const PLUGIN_README_URL = `${REPO}/blob/master/plugin/README.md`

/**
 * Putting the paper on a Kindle (plugin/README.md "Install"): the server address for the child
 * shown now and the steps to install the KOReader plugin and point it here.
 */
export function SetUpKindle() {
  const { kindle, derived, several, id } = useChildAddresses()
  const link = 'font-semibold text-ink underline underline-offset-2'
  return (
    <>
      <SectionTitle className="mt-2">Set up a Kindle</SectionTitle>
      <Card label="Set up a Kindle" className="flex flex-col gap-4">
        <Address label={several ? `Server address for ${id}` : 'Server address'} value={kindle} />
        <Steps>
          <Step n={1}>
            The Kindle needs KOReader, which means a jailbroken Kindle. Download the plugin from the{' '}
            <a className={link} href={PLUGIN_RELEASE_URL} target="_blank" rel="noreferrer">
              latest release
            </a>{' '}
            and unzip it.
          </Step>
          <Step n={2}>
            Connect the Kindle by USB and copy the <code className="text-[13px]">earlyeditionkids.koplugin</code> folder into{' '}
            <code className="text-[13px]">koreader/plugins</code>.
          </Step>
          <Step n={3}>
            Restart KOReader. In the Tools menu (the spanner), open <Path>Early Edition settings → Server address</Path>, type the
            address above and tap <Path>Save and check</Path>.
          </Step>
          <Step n={4}>
            So the paper arrives without anyone turning Wi-Fi on, set <Path>Network → Action when Wi-Fi is off → Turn on</Path>.
          </Step>
        </Steps>
        <p className="m-0 text-[13px] text-muted">
          The Kindle needs to be on the home Wi-Fi. It fetches the paper when it wakes and sends back what was read.{' '}
          <a className={link} href={PLUGIN_README_URL} target="_blank" rel="noreferrer">
            The plugin’s guide
          </a>{' '}
          covers updating it, Simple UI and gestures.
        </p>
        {derived && <GuessedAddressNote device="Kindle" />}
      </Card>
    </>
  )
}
