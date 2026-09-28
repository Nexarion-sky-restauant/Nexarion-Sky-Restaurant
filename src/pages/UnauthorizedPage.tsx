import { Link } from 'react-router-dom'

export default function UnauthorizedPage() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Not authorized</h1>
        <p className="card-note">
          Your account does not hold the permission required for that page. If you believe this is
          wrong, ask an owner or administrator to review your role.
        </p>
        <Link to="/" className="btn btn-primary">Back to dashboard</Link>
      </div>
    </div>
  )
}
