import { ControlCheckStatus } from '../components/ControlCheckStatus';

export const ControlCheckPage = () => (
  <section className="control-check-page">
    <div className="section-heading-row">
      <div>
        <h2>Control service</h2>
        <p>Ultima verificare facuta din butonul Discord.</p>
      </div>
    </div>

    <ControlCheckStatus />
  </section>
);
