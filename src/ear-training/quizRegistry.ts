export type QuizEntry = { id: string; title: string; href: string; detail: string }
export type QuizCategory = { id: string; title: string; quizzes: QuizEntry[] }

// Add future categories and implemented quizzes here; keep their routes in FeatureApp.
export const quizCategories: QuizCategory[] = [
  {
    id: 'ear-training',
    title: 'Ear training',
    quizzes: [
      {
        id: 'picardy-thirds',
        title: 'Picardy Thirds',
        href: '#quizzes/ear-training/picardy-thirds',
        detail: '8 examples · About 8 seconds each',
      },
    ],
  },
]
