CREATE TABLE categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

INSERT INTO categories (name) VALUES
    ('Mechanical Parts'), ('Raw Materials'), ('Electrical'),
    ('Heavy Equipment'), ('PPE'), ('Consumables'),
    ('Pneumatics'), ('Chemicals'), ('Automation'), ('General');
