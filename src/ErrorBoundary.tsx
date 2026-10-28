import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<main className="page"><div className="card empty" role="alert"><h2>Something went wrong.</h2><p className="muted">Your data is safe. Reload to try again.</p><button className="btn" onClick={()=>location.reload()}>Reload</button></div></main>:this.props.children}
}
