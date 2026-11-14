import type { StoryDetail } from '../api/types'

/**
 * The story as he sees it. body_html is trusted server output (the story file's
 * <body> content); it is rendered inside .kindle-page, which contains its layout
 * so nothing in it can break the page. If the server sends only the story's
 * paragraphs (no <h1>), the heading and boxes are added around it to match the
 * story file.
 */
export function KindlePage({ story }: { story: StoryDetail }) {
  const full = /<h1[\s>]/i.test(story.body_html)
  return (
    <div className="kindle-page rounded-2xl border border-line px-5 py-6 sm:px-8 sm:py-8">
      {!full && (
        <>
          <p className="kicker">
            {story.topic.toUpperCase()} · {story.minutes} MINUTE READ
          </p>
          <h1>{story.title}</h1>
        </>
      )}
      <div dangerouslySetInnerHTML={{ __html: story.body_html }} />
      {!full && story.word_to_know && (
        <div className="box">
          <p className="label">WORD TO KNOW</p>
          <p>
            <b>{story.word_to_know.word}</b>: {story.word_to_know.definition}
          </p>
        </div>
      )}
      {!full && story.think_about_it && (
        <div className="box">
          <p className="label">THINK ABOUT IT</p>
          <p>{story.think_about_it}</p>
        </div>
      )}
      {!full && <p className="source">Source: {story.source_name}</p>}
    </div>
  )
}
