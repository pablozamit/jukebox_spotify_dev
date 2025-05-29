import React from 'react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout could potentially include admin-specific navigation, headers, etc.
  // in a more complex application. For now, it just renders the children.
  return <>{children}</>;
}
