import { useState } from 'react';
import presentation from '../data/presentation.json';

export function StoryVideo() {
  const [failed, setFailed] = useState(false);
  return <section id="presentation" className="presentation-section">
    <div className="section-heading"><div><span className="eyebrow">WHERE IT ALL BEGAN</span><h2>A little story.<br/>A very big friendship.</h2></div><p>It started with a Canva presentation.<br/>Now there’s a whole world to explore.</p></div>
    <div className="presentation-layout">
      <div className="story-video-player">
        <video controls playsInline preload="none" poster={presentation.posterPath} aria-label="The Axolotl — original Canva presentation" onError={() => setFailed(true)}>
          <source src={presentation.videoPath} type="video/mp4" />
          Your browser does not support video playback. <a href={presentation.videoPath}>Download The Axolotl</a>.
        </video>
        {failed && <p role="alert">The video could not load. <a href={presentation.videoPath}>Download the video</a> or open the Canva original.</p>}
        <details className="story-transcript"><summary>Read the story</summary>{presentation.slides.filter(slide => slide.text.trim()).map(slide => <p key={slide.page}>{slide.text}</p>)}</details>
      </div>
      <div className="story-note"><span className="hand-star">✦</span><span className="eyebrow">MEET THE ORIGINAL</span><h3>The Axolotl</h3><p>An axolotl, a lake, and a new best friend. Sometimes that’s all a good adventure needs.</p><span className="story-credit">Written by our young creator</span><a className="button secondary" href={presentation.viewUrl} target="_blank" rel="noopener noreferrer">Open the Canva original ↗</a></div>
    </div>
  </section>;
}
