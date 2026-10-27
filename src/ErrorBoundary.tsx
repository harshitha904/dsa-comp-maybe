import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<main><section className="panel" role="alert"><h1>The workspace could not render.</h1><p>Your persisted data is still stored locally. Reload to reconnect.</p><button className="button" onClick={()=>location.reload()}>Reload workspace</button></section></main>:this.props.children}
}
