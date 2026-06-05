<?php
/**
 * Template for the "About Us" page (slug: about).
 *
 * @package thermexpertise
 */

get_header();
?>

<section class="page-hero">
	<div class="container">
		<div class="breadcrumb"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'thermexpertise' ); ?></a> &nbsp;/&nbsp; <?php esc_html_e( 'About Us', 'thermexpertise' ); ?></div>
		<h1><?php esc_html_e( 'About Us', 'thermexpertise' ); ?></h1>
		<p><?php esc_html_e( 'Professional consultant engineers aiming to become a globally recognized Thai engineering consulting firm.', 'thermexpertise' ); ?></p>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="split">
			<div>
				<span class="eyebrow"><?php esc_html_e( 'Who We Are', 'thermexpertise' ); ?></span>
				<h2><?php esc_html_e( 'Established in 2021 by expert engineers', 'thermexpertise' ); ?></h2>
				<p><?php esc_html_e( 'Therm Expertise Co., Ltd. (THEX) was established in 2021 by a team of expert engineers with over 10 years of experience as industry consultants. We are professional consultant engineers aiming to become a globally recognized Thai engineering consulting firm.', 'thermexpertise' ); ?></p>
				<p><?php esc_html_e( 'Our team holds internationally recognized certifications, including those from UNIDO and TGO, and is proficient across Steam & Compressed Air System Optimization, HVAC Design, Energy Management & Auditing, and Productivity Process Improvement.', 'thermexpertise' ); ?></p>
			</div>
			<div class="about-card">
				<span class="role"><?php esc_html_e( 'Leadership', 'thermexpertise' ); ?></span>
				<p class="quote">&ldquo;<?php esc_html_e( 'Our expertise is dedicated to meeting your needs with professional precision, punctuality, success, and thoroughness.', 'thermexpertise' ); ?>&rdquo;</p>
				<div class="signature">
					<b>Suittipot S.</b>
					<span><?php esc_html_e( 'CEO / MD, Therm Expertise Co., Ltd.', 'thermexpertise' ); ?></span>
				</div>
			</div>
		</div>
	</div>
</section>

<section class="section section--soft">
	<div class="container">
		<div class="section-head">
			<span class="eyebrow"><?php esc_html_e( 'Our Direction', 'thermexpertise' ); ?></span>
			<h2><?php esc_html_e( 'Mission & Vision', 'thermexpertise' ); ?></h2>
		</div>
		<div class="services" style="grid-template-columns:repeat(2,1fr)">
			<article class="service-card">
				<div class="icon"><?php echo thex_icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
				<h3><?php esc_html_e( 'Our Mission', 'thermexpertise' ); ?></h3>
				<ul>
					<li><?php esc_html_e( 'Provide the best services, solutions and highest standard focused on customer satisfaction', 'thermexpertise' ); ?></li>
					<li><?php esc_html_e( 'Consecutively maximize competencies', 'thermexpertise' ); ?></li>
					<li><?php esc_html_e( 'Adhere to integrity and ethics', 'thermexpertise' ); ?></li>
				</ul>
			</article>
			<article class="service-card">
				<div class="icon"><?php echo thex_icon( 'globe' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
				<h3><?php esc_html_e( 'Our Vision', 'thermexpertise' ); ?></h3>
				<p><?php esc_html_e( 'To enhance through sustainable development, leveraging knowledge to benefit Thai industrial and agricultural sectors globally.', 'thermexpertise' ); ?></p>
			</article>
		</div>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="section-head">
			<span class="eyebrow"><?php esc_html_e( 'Experience', 'thermexpertise' ); ?></span>
			<h2><?php esc_html_e( 'Supporting public & private organizations', 'thermexpertise' ); ?></h2>
			<p><?php esc_html_e( 'We have supported government and private organizations through projects with leading ministries and institutes, and provide training and lecturing to industry, business, universities and research institutes.', 'thermexpertise' ); ?></p>
		</div>
		<div class="clients">
			<div class="client-chip"><?php esc_html_e( 'Ministry of Energy', 'thermexpertise' ); ?></div>
			<div class="client-chip"><?php esc_html_e( 'Ministry of Science & Technology', 'thermexpertise' ); ?></div>
			<div class="client-chip"><?php esc_html_e( 'Ministry of Industry', 'thermexpertise' ); ?></div>
			<div class="client-chip"><?php esc_html_e( 'Electrical & Electronics Institute', 'thermexpertise' ); ?></div>
		</div>
	</div>
</section>

<?php
get_footer();
