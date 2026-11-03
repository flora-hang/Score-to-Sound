/** How to read a PDF for free with Audiveris, then open the result here. */
export default function FreeReaderGuide({open = false}){
  return (
    <details className="freeguide" open={open}>
      <summary>Free option: convert your PDF with Audiveris</summary>
      <ol>
        <li>Download <a href="https://github.com/Audiveris/audiveris/releases" target="_blank" rel="noopener noreferrer">Audiveris</a>, a free score reader for Windows, Mac and Linux. Get it from its official GitHub page; other sites using the name aren't related to the project.</li>
        <li>Open your PDF in Audiveris and let it transcribe the score. Works best on clean, printed scores.</li>
        <li>Export the result as MusicXML (<code>.mxl</code> or <code>.musicxml</code>).</li>
        <li>Open that file here with <b>Open score</b>. Fix any wrong notes in <b>Edit notes</b>.</li>
      </ol>
      <p className="fine">The free route doesn't read lyrics, phone photos or numbered (jianpu) notation as well as AI reading does.</p>
    </details>
  );
}
