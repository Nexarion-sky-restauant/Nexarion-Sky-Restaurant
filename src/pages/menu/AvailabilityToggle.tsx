interface AvailabilityToggleProps {
  isAvailable: boolean
  disabled?: boolean
  onToggle: (next: boolean) => void
}

export default function AvailabilityToggle({ isAvailable, disabled, onToggle }: AvailabilityToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isAvailable}
      disabled={disabled}
      className={isAvailable ? 'switch switch-on' : 'switch'}
      onClick={() => onToggle(!isAvailable)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{isAvailable ? 'Available' : 'Unavailable'}</span>
    </button>
  )
}
