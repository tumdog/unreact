import React from 'react';

const RealInput = ({ required }) => <input type="email" value="" required={required} />;
const Input = ({ error, errorMsg }) => (
  <div>
    {error && errorMsg ? <p className="ulp-input-message ulp-input-errormsg">{errorMsg}</p> : null}
  </div>
);
const Input2 = ({ error, errorMsg }) => (
  <div>
    {errorMsg && error ? <p className="ulp-input-message ulp-input-errormsg">{errorMsg}</p> : null}
  </div>
);
const Notice = ({ name, description }) => (
  <p>
    This {name} list {description}
    <strong>{name + ' ' + description}</strong>
  </p>
);
const Button = ({ appearence }) => (
  <button className={`btn btn-${appearence || 'default'}`}>Submit</button>
);
const Container = ({ className, children }) => <div className={className}>{children}</div>;
const Item = ({ name, children }) => <li>{children}</li>;
const List = ({ list, name, error }) => (
  <Container className="container">
    <Notice name={name} description="is awesome" />
    <ul className={undefined}>{list.map(item => <Item>{item}</Item>)}</ul>
    <Button appearence="light" />
    <Input errorMsg="E-mail must be valid." error={error} />
    <Input2 errorMsg="E-mail must be valid." error={error} />
    <RealInput required />
    <RealInput required={false} />
    <RealInput required={null} />
  </Container>
);

export default List;
