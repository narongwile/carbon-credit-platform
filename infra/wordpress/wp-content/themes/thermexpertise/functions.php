<?php
/**
 * THERM Expertise theme functions.
 *
 * @package thermexpertise
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'THEX_VERSION', '7.0.0' );

/**
 * Theme setup.
 */
function thex_setup() {
	load_theme_textdomain( 'thermexpertise', get_template_directory() . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'custom-logo', array( 'height' => 60, 'width' => 220, 'flex-height' => true, 'flex-width' => true ) );

	register_nav_menus(
		array(
			'primary' => __( 'Primary Menu', 'thermexpertise' ),
			'footer'  => __( 'Footer Menu', 'thermexpertise' ),
		)
	);
}
add_action( 'after_setup_theme', 'thex_setup' );

/**
 * Enqueue styles and scripts.
 */
function thex_assets() {
	// Web fonts.
	wp_enqueue_style(
		'thex-fonts',
		'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700;800&family=Noto+Sans+Thai:wght@400;600;700&display=swap',
		array(),
		null
	);

	// Theme header stylesheet (required by WordPress).
	wp_enqueue_style( 'thex-style', get_stylesheet_uri(), array(), THEX_VERSION );

	// Main stylesheet.
	wp_enqueue_style( 'thex-main', get_theme_file_uri( 'assets/css/main.css' ), array( 'thex-style' ), THEX_VERSION );

	// Scripts.
	wp_enqueue_script( 'thex-main', get_theme_file_uri( 'assets/js/main.js' ), array(), THEX_VERSION, true );
}
add_action( 'wp_enqueue_scripts', 'thex_assets' );

/**
 * Central company profile — single source of truth for contact details.
 *
 * @return array
 */
function thex_company() {
	return array(
		'name'      => 'THERM Expertise Co., Ltd.',
		'short'     => 'THEX',
		'tagline'   => 'Engineering Solutions for Your Business',
		'phone'     => '(+66) 86-981-4931',
		'phone_raw' => '+66869814931',
		'email'     => 'thermexpertise.thex@gmail.com',
		'address'   => 'No.187 Moo 4, Naraphirom Sub-district, Bang Len District, Nakhon Pathom 73130, Thailand',
		'area'      => 'Thailand and Southeast Asia',
		'facebook'  => 'https://www.facebook.com/thermexpertise',
		'founded'   => '2021',
	);
}

/**
 * Inline SVG icon helper.
 *
 * @param string $name Icon key.
 * @return string SVG markup.
 */
function thex_icon( $name ) {
	$s = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
	$paths = array(
		'steam'    => '<path d="M4 20h16"/><path d="M7 16c-1-2 1-3 0-5s1-3 0-5"/><path d="M12 16c-1-2 1-3 0-5s1-3 0-5"/><path d="M17 16c-1-2 1-3 0-5s1-3 0-5"/>',
		'air'      => '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h8a2.5 2.5 0 1 1-2.5 2.5"/>',
		'energy'   => '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
		'leaf'     => '<path d="M11 20A7 7 0 0 1 4 13c0-5 5-9 16-9 0 11-4 16-9 16Z"/><path d="M4 21c2-6 6-9 12-11"/>',
		'rnd'      => '<path d="M10 2v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9.5V2"/><path d="M8.5 14h7"/>',
		'iot'      => '<rect x="4" y="8" width="16" height="9" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><circle cx="12" cy="12.5" r="1.4"/>',
		'mep'      => '<path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
		'farm'     => '<path d="M3 21h18"/><path d="M5 21v-7l7-5 7 5v7"/><path d="M9 21v-5h6v5"/>',
		'training' => '<path d="m22 9-10-5L2 9l10 5 10-5Z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
		'phone'    => '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
		'mail'     => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
		'pin'      => '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
		'globe'    => '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>',
		'check'    => '<path d="M20 6 9 17l-5-5"/>',
		'fb'       => '<path d="M15 3h-3a4 4 0 0 0-4 4v3H5v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3Z"/>',
		'box'      => '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="m12 13v8"/>',
		'arrow'    => '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
	);
	$svg = $s . ( isset( $paths[ $name ] ) ? $paths[ $name ] : '' ) . '</svg>';
	return $svg;
}

/**
 * The eight service offerings (mirrors the company's Services page).
 *
 * @return array
 */
function thex_services() {
	return array(
		array(
			'icon'  => 'steam',
			'title' => 'Steam & Compressed Air Optimization',
			'desc'  => 'Survey, measurement and engineering–economic analysis to fine-tune and implement efficient utility systems.',
			'items' => array( 'System survey & measurement', 'Engineering & economic analysis', 'Smart steam & compressed air', 'Chiller & cooling tower service' ),
		),
		array(
			'icon'  => 'iot',
			'title' => 'IoT for Smart Industrial',
			'desc'  => 'An advanced platform that combines data analytics, IoT and engineering to control, predict and prevent manufacturing issues.',
			'items' => array( 'Data analytics platform', 'Predictive monitoring', 'Process control & alerts' ),
		),
		array(
			'icon'  => 'energy',
			'title' => 'Energy Management & Optimization',
			'desc'  => 'End-to-end energy management improvement from measurement through ENPI analysis to project delivery.',
			'items' => array( 'Survey & measurement', 'ENPI & energy cost analysis', 'Improvement prescriptions', 'Project management' ),
		),
		array(
			'icon'  => 'check',
			'title' => 'Manufacturing & Productivity',
			'desc'  => 'Process design and optimization to raise productivity, cut waste and embed lean culture.',
			'items' => array( 'Lean Six Sigma / Kaizen', 'VSM · OEE · TPS', 'Waste & resource reduction' ),
		),
		array(
			'icon'  => 'rnd',
			'title' => 'Special Project: R&D',
			'desc'  => 'Custom engineering R&D — thermal machines, pressure vessels, automation concepts and medical devices.',
			'items' => array( 'Thermal machine & pressure vessel design', 'Machine modification, jigs, automation', 'Medical devices & assistive equipment' ),
		),
		array(
			'icon'  => 'training',
			'title' => 'Training Courses',
			'desc'  => 'Internationally recognized training delivered by certified expert engineers (UNIDO / TGO).',
			'items' => array( 'CFP · CFO · LCA · SBTi', 'SSO & CaSO (UNIDO)', 'Applied Thermodynamics', 'Automation & Robotics basics' ),
		),
		array(
			'icon'  => 'mep',
			'title' => 'MEP System',
			'desc'  => 'Full MEP design & installation — from cooling-load calculation and DWG drawings to fire and electrical systems.',
			'items' => array( 'HVAC & ventilation sizing', 'Plumbing & fire protection', 'Electrical, data, CCTV & access' ),
		),
		array(
			'icon'  => 'farm',
			'title' => 'Smart Aquaponic Farm',
			'desc'  => 'Comprehensive design and full-service smart aquaponic systems integrating IoT for sustainable agriculture.',
			'items' => array( 'Smart farm & aquaponic design', 'IoT integration', 'Sustainable agriculture' ),
		),
	);
}

/**
 * Products from the company catalog ("Product of THEX").
 *
 * @return array
 */
function thex_products() {
	return array(
		array( 'model' => 'MD0001M',  'name' => 'Model MD0001M',  'desc' => 'Engineering instrument from the THEX product line.', 'soon' => false ),
		array( 'model' => 'MD0001XL', 'name' => 'Model MD0001XL', 'desc' => 'Extended-capacity variant of the THEX MD series.',     'soon' => false ),
		array( 'model' => 'MD0001ST', 'name' => 'Model MD0001ST', 'desc' => 'Standard configuration of the THEX MD series.',          'soon' => false ),
		array( 'model' => '04',       'name' => 'Product 04',      'desc' => 'Detail is coming soon…', 'soon' => true ),
		array( 'model' => '05',       'name' => 'Product 05',      'desc' => 'Detail is coming soon…', 'soon' => true ),
		array( 'model' => '06',       'name' => 'Product 06',      'desc' => 'Detail is coming soon…', 'soon' => true ),
	);
}

/**
 * Clients / partners shown on the homepage.
 *
 * @return array
 */
function thex_clients() {
	return array(
		array( 'name' => 'KMUTT', 'sub' => "King Mongkut's University of Technology Thonburi" ),
		array( 'name' => 'EEI',   'sub' => 'Electrical & Electronics Institute' ),
		array( 'name' => 'TED',   'sub' => 'Thai Engineering Development' ),
		array( 'name' => 'NSTDA', 'sub' => 'สวทช. — National Science & Technology Development Agency' ),
		array( 'name' => 'UNIDO', 'sub' => 'Certification partner' ),
		array( 'name' => 'TGO',   'sub' => 'Greenhouse Gas Management Organization' ),
	);
}

/**
 * Very small, dependency-free contact-form handler.
 * Sends mail to the company address and redirects back with a status flag.
 */
function thex_handle_contact() {
	if ( empty( $_POST['thex_contact_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['thex_contact_nonce'] ) ), 'thex_contact' ) ) {
		return;
	}

	$company = thex_company();
	$name    = isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : '';
	$email   = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
	$subject = isset( $_POST['subject'] ) ? sanitize_text_field( wp_unslash( $_POST['subject'] ) ) : 'Website inquiry';
	$message = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';
	$back    = wp_get_referer() ? wp_get_referer() : home_url( '/contact/' );

	if ( ! $name || ! is_email( $email ) || ! $message ) {
		wp_safe_redirect( add_query_arg( 'contact', 'error', $back ) );
		exit;
	}

	$body    = "Name: {$name}\nEmail: {$email}\nSubject: {$subject}\n\n{$message}\n";
	$headers = array( 'Reply-To: ' . $name . ' <' . $email . '>' );
	wp_mail( $company['email'], '[Website] ' . $subject, $body, $headers );

	wp_safe_redirect( add_query_arg( 'contact', 'sent', $back ) );
	exit;
}
add_action( 'admin_post_nopriv_thex_contact', 'thex_handle_contact' );
add_action( 'admin_post_thex_contact', 'thex_handle_contact' );

/**
 * Fallback menu when no menu is assigned to the "primary" location.
 */
function thex_fallback_menu() {
	$items = array(
		'/'          => __( 'Home', 'thermexpertise' ),
		'/about/'    => __( 'About Us', 'thermexpertise' ),
		'/services/' => __( 'Services', 'thermexpertise' ),
		'/products/' => __( 'Products', 'thermexpertise' ),
		'/contact/'  => __( 'Contact', 'thermexpertise' ),
	);
	echo '<ul id="primary-menu" class="nav">';
	foreach ( $items as $path => $label ) {
		printf( '<li><a href="%s">%s</a></li>', esc_url( home_url( $path ) ), esc_html( $label ) );
	}
	echo '</ul>';
}
