export function TrainingBadge({ className = '' }: { readonly className?: string }) {
  const classes = className ? `training-badge ${className}` : 'training-badge';
  return <span className={classes}>訓練</span>;
}
