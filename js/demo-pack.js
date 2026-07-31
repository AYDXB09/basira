/* ==========================================================================
 * demo-pack.js — 2-minute LIVE DEMO prefill for a fictional Grade 5 learner
 * ========================================================================== */
(function () {
  window.DEMO_PACK = {
    student: {
      grade: 5,
      vision: 'congenital',
      notes: 'Blind from birth. Prefers part-to-whole tactile/sound analogies.'
    },
    classroom: {
      course: 'Grade 5 Science',
      teacher: 'Ms. Rivera',
      materials: [
        {
          title: 'Space Unit — Quiz Prep',
          type: 'assignment',
          text: 'SPACE QUIZ (Grade 5). Topics: planets in order from the Sun; what a star is; Moon orbits Earth; day/night from Earth spinning; simple gravity. Questions include: 1) Name the planet closest to the Sun. 2) Why do we have day and night? 3) What is the Sun? 4) Does the Moon make its own light?'
        }
      ],
      courseWork: [
        {
          title: 'Space Quiz',
          due: 'this week',
          questions: [
            'Name the planet closest to the Sun.',
            'Why do we have day and night?',
            'What is the Sun — a planet, a star, or a moon?',
            'Does the Moon make its own light? Explain simply.'
          ]
        }
      ],
      announcements: ['Space quiz this week. Review planets and day/night.']
    },
    lastWeek: {
      subject: 'Biology',
      title: 'Last week: Plant parts and what they do',
      teach: [
        {
          title: 'The big idea',
          text: 'A plant is a living thing that makes its own food. Think of it as a body with jobs split across parts you can name one at a time.'
        },
        {
          title: 'Roots',
          text: "Roots are like drinking straws under the ground. They hold the plant still and pull water and minerals up."
        },
        {
          title: 'Stem',
          text: "The stem is the plant's hallway. It carries water up and holds leaves toward light."
        },
        {
          title: 'Leaves',
          text: 'Leaves are the kitchen. They use light, air, and water to make sugar food — that process is called photosynthesis. You do not need the word first; you need the job: leaves cook food using light.'
        },
        {
          title: 'Recap',
          text: 'Roots drink and anchor. Stem carries and holds. Leaves cook food with light. Together that is how a plant lives.'
        }
      ]
    },
    memoriesSeed: [
      { key: 'grade', value: '5' },
      { key: 'vision', value: 'blind from birth' },
      { key: 'class', value: 'Grade 5 Science with Ms. Rivera' },
      { key: 'current_unit', value: 'Space — planets, Sun, Moon, day and night' },
      {
        key: 'last_week',
        value:
          'Biology plant parts: roots, stem, leaves, photosynthesis as leaves cooking food with light'
      }
    ]
  };
})();
