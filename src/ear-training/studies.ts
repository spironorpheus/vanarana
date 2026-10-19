export type Answer = 'minor' | 'picardy'
export type Study = { id: number; type: Answer; key: string; instrument: string; progression: string; third: string; explanation: string }
export const studies: Study[] = [
 {id:1,type:'minor',key:'A minor',instrument:'Piano',progression:'i – iv – V – i',third:'C',explanation:'The tonic keeps its minor third, C, so the phrase closes in A minor.'},
 {id:2,type:'picardy',key:'D minor',instrument:'Synthesized orchestra',progression:'i – ii°6 – V – I',third:'F♯',explanation:'The expected F is raised to F♯, turning the final tonic into D major.'},
 {id:3,type:'picardy',key:'E minor',instrument:'Piano',progression:'i – iv – V – I',third:'G♯',explanation:'The expected G is raised to G♯, turning the final tonic into E major.'},
 {id:4,type:'minor',key:'G minor',instrument:'Synthesized orchestra',progression:'i – ii°6 – V – i',third:'B♭',explanation:'The tonic keeps its minor third, B♭, so the phrase closes in G minor.'},
 {id:5,type:'picardy',key:'B minor',instrument:'Piano',progression:'i – VI – V – I',third:'D♯',explanation:'The expected D is raised to D♯, turning the final tonic into B major.'},
 {id:6,type:'minor',key:'C minor',instrument:'Synthesized orchestra',progression:'i – iv – V – i',third:'E♭',explanation:'The tonic keeps its minor third, E♭, so the phrase closes in C minor.'},
 {id:7,type:'minor',key:'F♯ minor',instrument:'Piano',progression:'i – VI – V – i',third:'A',explanation:'The tonic keeps its minor third, A, so the phrase closes in F♯ minor.'},
 {id:8,type:'picardy',key:'F minor',instrument:'Synthesized orchestra',progression:'i – iv – V – I',third:'A',explanation:'The expected A♭ is raised to A, turning the final tonic into F major.'}
];
