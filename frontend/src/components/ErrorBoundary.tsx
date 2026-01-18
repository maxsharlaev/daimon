import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("UI crashed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "white", fontFamily: "ui-monospace, monospace" }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>UI error</div>
          <div>{String(this.state.error.message || this.state.error)}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

