-- Enable PostGIS extension for geospatial data
CREATE EXTENSION IF NOT EXISTS postgis;

-- ==========================================
-- 1. Dynamic RBAC System
-- ==========================================

-- Roles Table: Dynamic definitions (e.g., 'Community', 'Ranger')
CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT FALSE -- Protects critical roles from deletion
);

-- Permissions Table: Granular capabilities (e.g., 'submit_report', 'validate_report')
CREATE TABLE permissions (
    permission_id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL, -- code-referenceable name
    description TEXT
);

-- Role-Permissions Join Table: The mutable matrix
CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ==========================================
-- 2. Users & Core Data
-- ==========================================

-- Users Table
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- For auth
    role_id INTEGER REFERENCES roles(role_id) ON DELETE SET NULL,
    region_id UUID, -- NULL for Admins or Global Analysts
    clearance_level INTEGER DEFAULT 1 CHECK (clearance_level BETWEEN 1 AND 5),
    verification_status VARCHAR(20) DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'SUSPENDED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Species Table
CREATE TABLE species (
    species_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    common_name VARCHAR(100) NOT NULL,
    scientific_name VARCHAR(100),
    endangered_flag BOOLEAN DEFAULT FALSE,
    default_sensitivity_tier INTEGER DEFAULT 1 CHECK (default_sensitivity_tier BETWEEN 1 AND 4)
);

-- Reports Table
CREATE TABLE reports (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    species_id UUID REFERENCES species(species_id),
    geom GEOMETRY(POINT, 4326) NOT NULL, -- WGS84 coordinates
    sighting_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    media_url TEXT, -- Stores path or URL to image/audio
    description TEXT,
    ai_confidence_score DECIMAL(5, 2) CHECK (ai_confidence_score BETWEEN 0 AND 100),
    validation_status VARCHAR(20) DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING', 'VALIDATED', 'REJECTED')),
    validated_by UUID REFERENCES users(user_id),
    validated_at TIMESTAMP WITH TIME ZONE,
    sensitivity_tier INTEGER NOT NULL CHECK (sensitivity_tier BETWEEN 1 AND 4),
    region_id UUID NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log Table
CREATE TABLE audit_logs (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    action_type VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    action_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    meta_data JSONB
);

-- ==========================================
-- 3. Indexes & Constraints
-- ==========================================

CREATE INDEX idx_reports_geom ON reports USING GIST (geom);
CREATE INDEX idx_reports_region ON reports(region_id);
CREATE INDEX idx_reports_status ON reports(validation_status);
CREATE INDEX idx_reports_tier ON reports(sensitivity_tier);
CREATE INDEX idx_users_role ON users(role_id);
