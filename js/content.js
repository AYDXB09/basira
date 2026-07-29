/* ============================================================================
 * content.js — preloaded course so the demo starts teaching instantly.
 * "Physics Lecture — Chapter 5: Forces & Motion", including THE money moment:
 * the lecturer's velocity-time graph, taught the blind-pedagogy way.
 * Uploads (ingest.js) replace this at runtime; voice command "continue
 * learning" always has something to teach.
 * ========================================================================== */
window.CONTENT = {
  lesson: {
    title: 'Physics Lecture — Chapter 5: Forces & Motion',
    segments: [
      {
        title: 'Where we are',
        teach: 'Chapter five is about one big idea: forces change motion. Last time you learned that a force is a push or a pull. Today the lecture builds on that with Newton\'s second law, and then reads a graph that shows it happening. I\'ll take you through it piece by piece.'
      },
      {
        title: 'Newton\'s second law',
        teach: 'Newton\'s second law says: force equals mass times acceleration. Feel it with your own hands. Pushing an empty school bag across a desk is easy — small mass, so your push creates a lot of acceleration. Now imagine the same push on a bag full of books. Same force, more mass, so it barely speeds up. That trade is the whole law: for the same push, more mass means less acceleration.'
      },
      {
        title: 'The graph the lecturer showed',
        teach: 'Here the lecturer said, quote, as you can see on this graph, unquote. So let me actually teach you that graph. It is a velocity-time graph: it tracks how fast the trolley moves, moment by moment, like a story told left to right. At the start, the trolley is still — silence, no motion. Then a constant force is switched on, and the speed climbs steadily, like a note sliding evenly up in pitch, never jumping. That steady, even climb is the fingerprint of constant acceleration. Halfway through, the force is doubled — and the pitch now slides up twice as fast. Same trolley, double the force, double the acceleration. That is Newton\'s second law drawn as a line.'
      },
      {
        title: 'Why the steepness matters',
        teach: 'On any velocity-time graph, the steepness of the climb IS the acceleration. Gentle climb, gentle acceleration. Steep climb, strong acceleration. Flat means the speed is not changing at all. In the exam, when they ask you to compare accelerations on such a graph, they are only asking: which part climbs faster?'
      },
      {
        title: 'Recap',
        teach: 'Recap of chapter five so far. One: force equals mass times acceleration — same push, heavier object, less speed-up. Two: a velocity-time graph tells the speed story left to right, and the steepness of the line is the acceleration. Three: double the force on the same mass, and the climb gets exactly twice as steep. You are ready for a knowledge check whenever you want — just say quiz me.'
      }
    ]
  }
};
