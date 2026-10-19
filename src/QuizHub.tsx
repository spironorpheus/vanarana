import { quizCategories } from './ear-training/quizRegistry'

export default function QuizHub() {
  return <main className="quiz-hub">
    <h1>Quizzes</h1>
    <div className="quiz-category-list">{quizCategories.map(category => <section key={category.id} aria-labelledby={`category-${category.id}`}>
      <h2 id={`category-${category.id}`}>{category.title}</h2>
      <div className="quiz-card-grid">{category.quizzes.map(quiz => <a className="quiz-card" href={quiz.href} key={quiz.id}>
        <h3>{quiz.title}<span aria-hidden="true">↗</span></h3>
        <small>{quiz.detail}</small>
      </a>)}</div>
    </section>)}</div>
  </main>
}
