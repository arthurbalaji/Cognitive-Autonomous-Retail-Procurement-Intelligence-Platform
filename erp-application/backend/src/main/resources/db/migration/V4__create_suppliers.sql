CREATE TABLE suppliers (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150),
    email VARCHAR(150),
    phone VARCHAR(20),
    address VARCHAR(500),
    gst_number VARCHAR(20),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO suppliers (company_name, contact_person, email, phone, address, gst_number) VALUES
    ('Steel Authority of India', 'Arun Mehta', 'arun@sail.com', '9812345670', 'Ispat Bhawan, Lodhi Road, New Delhi', '07AABCS1111A1Z1'),
    ('Havells India Ltd', 'Sneha Rao', 'sneha@havells.com', '9812345671', 'QRG Tower, Central Business Park, Noida', '09AABCH2222B2Z2'),
    ('ABB India', 'Karthik Nair', 'karthik@abb.co.in', '9812345672', 'Plot-1 MIDC, Nashik', '27AABCA3333C3Z3'),
    ('Bosch Rexroth India', 'Deepak Joshi', 'deepak@boschrexroth.in', '9812345673', 'Sector 32, Gurgaon', '06AABCB4444D4Z4');
